const MAX_CONCURRENT_JOBS = 3;
const WEI_PER_ETH = 10n ** 18n;

function formatExactEthAmount(amount, minimumFractionDigits = 3) {
  const match = String(amount ?? "0").trim().match(/^(\d+)(?:\.(\d{1,18}))?$/);

  if (!match) return `0.${"0".repeat(minimumFractionDigits)}`;

  const [, whole, fraction = ""] = match;
  const wei =
    BigInt(whole) * WEI_PER_ETH + BigInt(fraction.padEnd(18, "0"));
  const integerPart = wei / WEI_PER_ETH;
  const decimalPart = (wei % WEI_PER_ETH)
    .toString()
    .padStart(18, "0")
    .replace(/0+$/, "")
    .padEnd(minimumFractionDigits, "0");

  return decimalPart ? `${integerPart}.${decimalPart}` : integerPart.toString();
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    if (typeof window.ethereum === "undefined") {
      window.location.href = "index.html";
      return;
    }

    const accounts = await window.ethereum.request({
      method: "eth_accounts",
    });

    if (!accounts?.length) {
      window.location.href = "index.html";
      return;
    }

    const currentAccount = accounts[0];
    const walletLower = currentAccount.toLowerCase();

    localStorage.setItem("wallet", currentAccount);
    localStorage.setItem("userRole", "carrier");
    localStorage.setItem("role", "carrier");

    const shortAddress =
      currentAccount.substring(0, 6) +
      "..." +
      currentAccount.substring(currentAccount.length - 4);

    await loadSidebar(shortAddress, currentAccount);
    await loadNetworkInfo();
    await loadCarrierDashboard(walletLower, currentAccount);

    const searchInput = document.getElementById("search-input");
    if (searchInput) {
      searchInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          window.location.href = "agreements.html?role=carrier";
        }
      });
    }
  } catch (error) {
    console.error("Error loading carrier dashboard:", error);
  }
});

async function loadSidebar(shortAddress, fullAddress) {
  const response = await fetch("sidebar.html");
  const sidebarHtml = await response.text();
  const container = document.getElementById("sidebar-container");
  if (!container) return;

  container.innerHTML = sidebarHtml;

  const roleNameEl = document.getElementById("sidebar-role-name");
  const profileIconEl = document.getElementById("sidebar-profile-icon");
  const menuListEl = document.getElementById("sidebar-menu-list");
  const sidebarWalletEl = document.getElementById("sidebar-wallet-addr");
  const topWallet = document.getElementById("top-wallet-address");

  if (roleNameEl) roleNameEl.innerText = "Carrier";
  if (profileIconEl) {
    profileIconEl.className = "profile-icon carrier-icon-bg";
    profileIconEl.innerHTML = '<i class="fa-solid fa-truck-fast"></i>';
  }
  if (sidebarWalletEl) {
    sidebarWalletEl.innerText = shortAddress;
    sidebarWalletEl.title = fullAddress;
  }
  if (topWallet) {
    topWallet.innerText = shortAddress;
    topWallet.title = fullAddress;
  }

  if (menuListEl) {
    menuListEl.innerHTML = `
            <li>
                <a href="carrierDashboard.html" class="active">
                    <i data-lucide="layout-dashboard"></i>
                    Dashboard
                </a>
            </li>
            <li>
                <a href="agreements.html?role=carrier">
                    <i data-lucide="box"></i>
                    Available Jobs
                </a>
            </li>
            <li>
                <a href="milestones.html">
                    <i data-lucide="target"></i>
                    Milestones
                </a>
            </li>
            <li>
                <a href="transactionHistory.html?role=carrier">
                    <i data-lucide="history"></i>
                    Transaction History
                </a>
            </li>
            <li>
                <a href="profile.html">
                    <i data-lucide="user-round"></i>
                    Profile
                </a>
            </li>
        `;
  }

  // Carrier-only LogiTrust widget under menu
  const footer = container.querySelector(".sidebar-footer");
  const tokenBox = document.createElement("div");
  tokenBox.className = "carrier-token-box";
  tokenBox.innerHTML = `
        <span class="carrier-token-label">LOGITRUST TOKENS</span>
        <strong id="sidebar-token-balance">0 LTT</strong>
        <span class="carrier-token-hint">Earn on completed milestones</span>
    `;
  if (footer) {
    container.insertBefore(tokenBox, footer);
  } else {
    container.appendChild(tokenBox);
  }

  if (typeof lucide !== "undefined") lucide.createIcons();
}

async function loadNetworkInfo() {
  const web3 = new Web3(window.ethereum);
  const chainId = await web3.eth.getChainId();
  const chainIdEl = document.getElementById("chain-id");
  if (chainIdEl) chainIdEl.innerText = chainId;

  try {
    const gasWei = await web3.eth.getGasPrice();
    const gwei = Number(web3.utils.fromWei(gasWei, "gwei")).toFixed(0);
    const gasEl = document.getElementById("gas-price");
    if (gasEl) gasEl.innerText = `${gwei} Gwei`;
  } catch (_) {}

  try {
    const response = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
    );
    const data = await response.json();
    const price = data?.ethereum?.usd;
    const ethEl = document.getElementById("eth-price");
    if (ethEl && price) ethEl.innerText = `$${Number(price).toLocaleString()}`;
  } catch (_) {}
}

async function loadCarrierDashboard(walletLower, currentAccount) {
  const { data, error } = await supabaseClient
    .from("agreements")
    .select("*")
    .eq("chain_id", ACTIVE_CHAIN_ID)
    .order("agreement_id", { ascending: false });

  if (error) throw error;

  const agreements = data || [];

  const available = agreements.filter((a) => normalize(a.status) === "created");

  const myJobs = agreements.filter(
    (a) => a.carrier_address && a.carrier_address.toLowerCase() === walletLower,
  );

  const active = myJobs.filter((a) => normalize(a.status) === "in progress");

  const completed = myJobs.filter((a) => normalize(a.status) === "completed");

  const now = new Date();
  const completedThisMonth = completed.filter((a) => {
    const ts = Number(a.completed_at || a.created_time || 0) * 1000;
    const d = ts > 0 ? new Date(ts) : new Date(a.created_at || 0);
    return (
      d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
    );
  }).length;

  const tokens = await loadCarrierTokenBalance(currentAccount);
  const lockedStake = await loadCarrierLockedStake(currentAccount);

  setText("kpi-locked-stake", `${lockedStake} ETH`);
  setText(
    "kpi-locked-stake-meta",
    active.length
      ? `Across ${active.length} active ${active.length === 1 ? "agreement" : "agreements"}`
      : "No stake currently locked",
  );
  setText("kpi-accepted", `${active.length}/${MAX_CONCURRENT_JOBS}`);
  setText("kpi-completed", String(completed.length));
  setText("kpi-completed-meta", `+ ${completedThisMonth} this month`);
  setText("kpi-tokens", `${tokens} LTT`);

  const sidebarTokens = document.getElementById("sidebar-token-balance");
  if (sidebarTokens) sidebarTokens.innerText = `${tokens} LTT`;

  await renderPaymentBreakdown(active);
  renderAvailableJobs(available.slice(0, 8), active.length, currentAccount);
}

async function loadCarrierTokenBalance(wallet) {
  try {
    const web3 = new Web3(window.ethereum);
    const token = new web3.eth.Contract(TOKEN_ABI, TOKEN_CONTRACT_ADDRESS);
    const balanceWei = await token.methods.balanceOf(wallet).call();
    const balance = Web3.utils.fromWei(String(balanceWei), "ether");
    return Math.round(Number(balance) * 100) / 100;
  } catch (error) {
    console.warn("Could not load LTT balance:", error);
    return 0;
  }
}

async function renderPaymentBreakdown(activeJobs) {
  const track = document.getElementById("payment-milestone-track");
  const label = document.getElementById("payment-agreement-label");
  const link = document.getElementById("payment-details-link");
  const jobs = activeJobs || [];

  if (!track) return;

  if (!jobs.length) {
    if (label) label.innerText = "No active delivery yet";
    track.innerHTML =
      '<div class="carrier-empty">Accept a job to see milestone payout progress here.</div>';
    return;
  }

  if (label) {
    label.innerText = `${jobs.length} active ${jobs.length === 1 ? "agreement" : "agreements"}`;
  }
  if (link) {
    link.href = "milestones.html";
  }

  const { data: milestones } = await supabaseClient
    .from("milestones")
    .select("*")
    .in(
      "agreement_id",
      jobs.map((job) => Number(job.agreement_id)),
    )
    .eq("chain_id", ACTIVE_CHAIN_ID)
    .order("milestone_index", { ascending: true });

  const milestonesByAgreement = (milestones || []).reduce(
    (groups, milestone) => {
      const agreementId = Number(milestone.agreement_id);
      if (!groups[agreementId]) groups[agreementId] = [];
      groups[agreementId].push(milestone);
      return groups;
    },
    {},
  );

  const fallbackMilestones = [
    {
      checkpoint: "Goods Pickup",
      percentage: 30,
      verified: false,
      paid: false,
      completed: false,
    },
    {
      checkpoint: "Warehouse Arrival",
      percentage: 30,
      verified: false,
      paid: false,
      completed: false,
    },
    {
      checkpoint: "Final Delivery",
      percentage: 40,
      verified: false,
      paid: false,
      completed: false,
    },
  ];

  track.innerHTML = jobs
    .map((job) => {
      const agreementId = Number(job.agreement_id);
      const ref = job.reference_no || `LG-${agreementId}`;
      const list = milestonesByAgreement[agreementId]?.length
        ? milestonesByAgreement[agreementId]
        : fallbackMilestones;
      const escrow = Number(job.escrow_amount || 0);
      const milestonesHtml = list
        .map((milestone, index) => {
          const percentage = Number(milestone.percentage || 0);
          const eth = ((escrow * percentage) / 100).toFixed(2);
          const state = milestoneState(
            milestone,
            index,
            Number(job.current_milestone || 0),
          );

          return `
                <div class="carrier-milestone-item ${state}">
                    <div class="carrier-milestone-bar"></div>
                    <div class="carrier-milestone-copy">
                        <strong>${escapeHtml(milestone.checkpoint || `Milestone ${index + 1}`)}</strong>
                        <span>${stateLabel(state)}</span>
                    </div>
                    <div class="carrier-milestone-eth">
                        <i class="fa-brands fa-ethereum"></i> ${eth}
                    </div>
                </div>
            `;
        })
        .join("");

      const stake = (escrow * 0.3).toFixed(2);

      return `
            <section class="carrier-payment-agreement">
                <div class="carrier-payment-agreement-header">
                    <strong>${escapeHtml(ref)}</strong>
                    <a href="agreementDetails.html?id=${encodeURIComponent(agreementId)}">View agreement</a>
                </div>
                <div class="carrier-payment-milestones">
                    ${milestonesHtml}
                    <div class="carrier-milestone-item stake">
                        <div class="carrier-milestone-bar"></div>
                        <div class="carrier-milestone-copy">
                            <strong>Carrier Stake</strong>
                            <span>Paid to accept agreement</span>
                        </div>
                        <div class="carrier-milestone-eth">
                            <i class="fa-brands fa-ethereum"></i> ${stake}
                        </div>
                    </div>
                </div>
            </section>
        `;
    })
    .join("");
}

async function loadCarrierLockedStake(wallet) {
  try {
    const web3 = new Web3(window.ethereum);
    const contract = new web3.eth.Contract(CONTRACT_ABI, CONTRACT_ADDRESS);
    const lockedStakeWei = await contract.methods
      .getCarrierLockedStake(wallet)
      .call();
    const stake = Web3.utils.fromWei(String(lockedStakeWei), "ether");
    return Math.round(Number(stake) * 1000) / 1000;
  } catch (error) {
    console.warn("Could not load locked carrier stake:", error);
    return 0;
  }
}

function milestoneState(m, index, current) {
  if (m.paid || m.verified) return "completed";
  if (m.completed) return "active";
  if (index === current) return "active";
  if (index < current) return "completed";
  return "pending";
}

function stateLabel(state) {
  if (state === "completed") return "Completed";
  if (state === "active") return "Active";
  return "Pending";
}

function renderAvailableJobs(jobs, activeCount, currentAccount) {
  const body = document.getElementById("available-jobs-body");
  if (!body) return;

  if (!jobs.length) {
    body.innerHTML = `
            <tr>
                <td colspan="6" class="dash-empty-row">
                    No available agreements right now.
                </td>
            </tr>
        `;
    return;
  }

  const canAccept = activeCount < MAX_CONCURRENT_JOBS;

  body.innerHTML = jobs
    .map((job) => {
      const ref = job.reference_no || `LG-${job.agreement_id}`;
      const payload = truncate(job.shipment_details || "—", 40);
      const payment = formatExactEthAmount(job.escrow_amount || 0);
      const priority = String(job.priority || "Normal").toUpperCase();
      const deadline = formatDeadline(job.deadline);
      const id = Number(job.agreement_id);

      return `
            <tr>
                <td>${escapeHtml(ref)}</td>
                <td>${escapeHtml(payload)}</td>
                <td><i class="fa-brands fa-ethereum"></i> ${payment}</td>
                <td><span class="priority-badge priority-${priority.toLowerCase()}">${escapeHtml(priority)}</span></td>
                <td>${escapeHtml(deadline)}</td>
                <td class="carrier-actions">
                    <button
                        class="accept-btn"
                        ${canAccept ? "" : "disabled"}
                        onclick='acceptJobFromDashboard(${id}, ${JSON.stringify(ref)})'
                    >
                        Accept
                    </button>
                    <a class="view-link" href="agreementDetails.html?id=${id}">Details</a>
                </td>
            </tr>
        `;
    })
    .join("");

  if (!canAccept) {
    // keep buttons disabled already
  }
}

async function acceptJobFromDashboard(agreementId, referenceNo) {
  await sharedAcceptAgreement(agreementId, referenceNo, () =>
    window.location.reload(),
  );
}

function normalize(status) {
  return String(status || "")
    .trim()
    .toLowerCase();
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.innerText = value;
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
    day: "numeric",
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
