document.addEventListener("DOMContentLoaded", async () => {
    // Wait for dashboard.js sidebar boot, then load shipper stats.
    // dashboard.js already handles wallet + shipper sidebar for this page.
    try {
        const role = (
            localStorage.getItem("userRole") ||
            localStorage.getItem("role") ||
            "shipper"
        ).toLowerCase();

        if (role === "carrier" || role === "2") {
            window.location.replace("carrierDashboard.html");
            return;
        }

        // Give dashboard.js a moment to finish sidebar injection.
        setTimeout(async () => {
            try {
                await loadShipperDashboard();
                await loadShipperNetworkExtras();
            } catch (error) {
                console.error("Shipper dashboard data failed:", error);
            }
        }, 400);
    } catch (error) {
        console.error(error);
    }
});

async function loadShipperNetworkExtras() {
    if (typeof window.ethereum === "undefined") return;

    try {
        const web3 = new Web3(window.ethereum);
        const gasWei = await web3.eth.getGasPrice();
        const gwei = Number(web3.utils.fromWei(gasWei, "gwei")).toFixed(0);
        const gasEl = document.getElementById("gas-price");
        if (gasEl) gasEl.innerText = `${gwei} Gwei`;
    } catch (_) {}

    try {
        const response = await fetch(
            "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd"
        );
        const data = await response.json();
        const price = data?.ethereum?.usd;
        const ethEl = document.getElementById("eth-price");
        if (ethEl && price) ethEl.innerText = `$${Number(price).toLocaleString()}`;
    } catch (_) {}

    const wallet = localStorage.getItem("wallet");
    const topWallet = document.getElementById("top-wallet-address");
    if (wallet && topWallet) {
        topWallet.innerText =
            wallet.substring(0, 6) + "..." + wallet.substring(wallet.length - 4);
        topWallet.title = wallet;
    }
}

async function loadShipperDashboard() {
    const wallet = (localStorage.getItem("wallet") || "").toLowerCase();
    if (!wallet) return;

    const { data, error } = await supabaseClient
        .from("agreements")
        .select("*")
        .order("agreement_id", { ascending: false });

    if (error) throw error;

    const mine = (data || []).filter(
        (a) =>
            a.shipper_address &&
            a.shipper_address.toLowerCase() === wallet
    );

    const active = mine.filter((a) => {
        const s = normalize(a.status);
        return s === "created" || s === "in progress";
    });

    const completed = mine.filter(
        (a) => normalize(a.status) === "completed"
    );

    const closed = mine.filter((a) => {
        const s = normalize(a.status);
        return (
            s === "completed" ||
            s === "cancelled" ||
            s === "expired" ||
            s === "refunded"
        );
    });

    const escrow = active.reduce(
        (sum, a) => sum + Number(a.escrow_remaining ?? a.escrow_amount ?? 0),
        0
    );

    const now = new Date();
    const thisMonth = mine.filter((a) => {
        const ts = Number(a.created_time || 0) * 1000;
        const d = ts > 0 ? new Date(ts) : new Date(a.created_at || 0);
        return (
            d.getMonth() === now.getMonth() &&
            d.getFullYear() === now.getFullYear()
        );
    }).length;

    const successRate = closed.length
        ? Math.round((completed.length / closed.length) * 100)
        : 0;

    setText("shipper-kpi-total", String(mine.length));
    setText("shipper-kpi-total-meta", `+${thisMonth} this month`);
    setText("shipper-kpi-active", String(active.length));
    setText(
        "shipper-kpi-active-meta",
        `${active.filter((a) => normalize(a.status) === "in progress").length} in progress`
    );
    setText("shipper-kpi-escrow", escrow.toFixed(2));
    setText("shipper-kpi-completed", String(completed.length));
    setText("shipper-kpi-completed-meta", `${successRate}% success rate`);

    renderShipperAgreements(mine.slice(0, 6));
    renderShipperChart(mine);
}

function renderShipperAgreements(list) {
    const body = document.getElementById("shipper-agreements-body");
    if (!body) return;

    if (!list.length) {
        body.innerHTML = `
            <tr>
                <td colspan="7" class="dash-empty-row">
                    No agreements yet.
                    <a href="createAgreement.html">Create your first agreement</a>
                </td>
            </tr>
        `;
        return;
    }

    body.innerHTML = list.map((a) => {
        const ref = a.reference_no || `LG-${a.agreement_id}`;
        const carrier = a.carrier_address
            ? shorten(a.carrier_address)
            : "Unassigned";
        const payload = truncate(a.shipment_details || "—", 28);
        const escrow = Number(a.escrow_amount || 0).toFixed(2);
        const deadline = formatDeadline(a.deadline);
        const status = displayStatus(a.status);

        return `
            <tr>
                <td>${escapeHtml(ref)}</td>
                <td>${escapeHtml(carrier)}</td>
                <td>${escapeHtml(payload)}</td>
                <td><i class="fa-brands fa-ethereum"></i> ${escrow}</td>
                <td>${escapeHtml(deadline)}</td>
                <td>
                    <span class="status-badge ${statusClass(status)}">
                        <span class="status-dot"></span>
                        ${escapeHtml(status)}
                    </span>
                </td>
                <td>
                    <a class="view-link" href="agreementDetails.html?id=${Number(a.agreement_id)}">
                        View
                    </a>
                </td>
            </tr>
        `;
    }).join("");
}

function renderShipperChart(agreements) {
    const canvas = document.getElementById("shipper-volume-chart");
    if (!canvas || typeof Chart === "undefined") return;

    const months = buildLastSixMonths();
    const totals = months.map(() => 0);

    agreements.forEach((job) => {
        const ts = Number(job.created_time || 0) * 1000;
        const createdAt = ts > 0 ? new Date(ts) : new Date(job.created_at || Date.now());
        const key = `${createdAt.getFullYear()}-${createdAt.getMonth()}`;
        const index = months.findIndex((m) => m.key === key);
        if (index >= 0) {
            totals[index] += Number(job.escrow_amount || 0);
        }
    });

    const rangeEl = document.getElementById("shipper-chart-range");
    if (rangeEl && months.length) {
        rangeEl.innerText = `${months[0].label}-${months[months.length - 1].label} ${months[months.length - 1].year}`;
    }

    new Chart(canvas, {
        type: "line",
        data: {
            labels: months.map((m) => m.label),
            datasets: [{
                data: totals.map((v) => Number(v.toFixed(3))),
                borderColor: "#3b82f6",
                backgroundColor: "rgba(59, 130, 246, 0.15)",
                fill: true,
                tension: 0.35,
                pointRadius: 4,
                pointBackgroundColor: "#3b82f6",
                borderWidth: 3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: {
                    ticks: { color: "#8d99ae" },
                    grid: { color: "rgba(255,255,255,0.04)" }
                },
                y: {
                    beginAtZero: true,
                    ticks: { color: "#8d99ae" },
                    grid: { color: "rgba(255,255,255,0.06)" }
                }
            }
        }
    });
}

function buildLastSixMonths() {
    const result = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        result.push({
            key: `${d.getFullYear()}-${d.getMonth()}`,
            label: d.toLocaleString("en-US", { month: "short" }),
            year: d.getFullYear()
        });
    }
    return result;
}

function normalize(v) {
    return String(v || "").trim().toLowerCase();
}

function displayStatus(status) {
    const value = String(status || "Unknown");
    if (normalize(value) === "in progress") return "In Progress";
    return value.charAt(0).toUpperCase() + value.slice(1);
}

function statusClass(status) {
    const value = normalize(status);
    if (value === "in progress") return "status-active";
    if (value === "created") return "status-funded";
    if (value === "completed") return "status-completed";
    if (value === "cancelled" || value === "refunded") return "status-refunded";
    if (value === "expired") return "status-expired";
    return "status-available";
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.innerText = value;
}

function shorten(address) {
    if (!address) return "—";
    return address.substring(0, 6) + "..." + address.substring(address.length - 4);
}

function truncate(text, max) {
    const value = String(text || "");
    return value.length > max ? `${value.slice(0, max)}...` : value;
}

function formatDeadline(deadline) {
    const ts = Number(deadline);
    if (!ts) return "—";
    return new Date(ts * 1000).toLocaleString("en-US", {
        month: "short",
        day: "numeric"
    });
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}