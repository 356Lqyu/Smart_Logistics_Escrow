let currentProfileEmail = null;

document.addEventListener("DOMContentLoaded", async () => {
    try {
        if (typeof window.ethereum === "undefined") {
            window.location.href = "index.html";
            return;
        }

        const accounts = await window.ethereum.request({
            method: "eth_accounts"
        });

        if (!accounts?.length) {
            window.location.href = "index.html";
            return;
        }

        const wallet = accounts[0];
        localStorage.setItem("wallet", wallet);

        const short =
            wallet.substring(0, 6) +
            "..." +
            wallet.substring(wallet.length - 4);

        const topWallet = document.getElementById("top-wallet-address");
        if (topWallet) {
            topWallet.innerText = short;
            topWallet.title = wallet;
        }

        await loadProfile(wallet);
        setupEditModal(wallet);
        setupChangePasswordModal();

        const searchInput = document.getElementById("search-input");
        if (searchInput) {
            searchInput.addEventListener("keydown", (event) => {
                if (event.key === "Enter") {
                    const role =
                        localStorage.getItem("userRole") ||
                        localStorage.getItem("role") ||
                        "shipper";
                    window.location.href =
                        `agreements.html?role=${encodeURIComponent(role)}`;
                }
            });
        }
    } catch (error) {
        console.error("Profile page failed:", error);
    }
});

async function loadProfile(wallet) {
    const walletLower = wallet.toLowerCase();
    const roleRaw =
        localStorage.getItem("userRole") ||
        localStorage.getItem("role") ||
        "shipper";
    const isCarrier =
        String(roleRaw).toLowerCase() === "carrier" ||
        String(roleRaw) === "2";

    let user = null;

    try {
        const { data, error } = await supabaseClient
            .from("users")
            .select("*")
            .eq("wallet_address", walletLower)
            .maybeSingle();

        if (!error) user = data;
    } catch (error) {
        console.warn("Could not load user profile:", error);
    }

    const displayName =
        user?.name ||
        localStorage.getItem("name") ||
        (isCarrier ? "Carrier Account" : "Shipper Account");

    const email =
        user?.email ||
        localStorage.getItem("profileEmail") ||
        "Not set";

    currentProfileEmail = user?.email || null;

    const registeredAt =
        user?.created_at ||
        user?.registered_at ||
        null;

    setText("profile-name", displayName);
    setText(
        "profile-role-pill",
        `Role Locked — ${isCarrier ? "Carrier" : "Shipper"}`
    );
    setText(
        "profile-subtitle",
        isCarrier
            ? "Carrier logistics identity"
            : "Shipper logistics identity"
    );
    setText("profile-wallet", wallet);
    setText("profile-email", email);
    setText(
        "profile-registered",
        registeredAt
            ? new Date(registeredAt).toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric"
            })
            : "On-chain registered"
    );

    const avatar = document.getElementById("profile-avatar");
    if (avatar) {
        avatar.innerText = getInitials(displayName);
    }

    if (typeof web3 !== "undefined" || window.ethereum) {
        try {
            const w3 = new Web3(window.ethereum);
            const chainId = await w3.eth.getChainId();
            setText(
                "profile-network",
                chainId === 1337 || chainId === 5777
                    ? `Local Ganache (${chainId})`
                    : `Chain ${chainId}`
            );
        } catch (error) {
            console.warn("Network lookup failed:", error);
        }
    }

    const agreements = await loadRoleAgreements(walletLower, isCarrier);
    renderProfileStats(agreements, isCarrier);

    const editName = document.getElementById("edit-name-input");
    const editEmail = document.getElementById("edit-email-input");
    if (editName) editName.value = displayName === "Shipper Account" || displayName === "Carrier Account" ? "" : displayName;
    if (editEmail) editEmail.value = email === "Not set" ? "" : email;
}

async function loadRoleAgreements(walletLower, isCarrier) {
    const { data, error } = await supabaseClient
        .from("agreements")
        .select("*")
        .order("agreement_id", { ascending: false });

    if (error) {
        console.warn("Agreements load failed:", error);
        return [];
    }

    return (data || []).filter((a) => {
        if (isCarrier) {
            return (
                a.carrier_address &&
                a.carrier_address.toLowerCase() === walletLower
            );
        }
        return (
            a.shipper_address &&
            a.shipper_address.toLowerCase() === walletLower
        );
    });
}

function renderProfileStats(agreements, isCarrier) {
    const total = agreements.length;
    const completed = agreements.filter(
        (a) => normalize(a.status) === "completed"
    ).length;
    const active = agreements.filter((a) => {
        const s = normalize(a.status);
        return s === "created" || s === "in progress";
    }).length;
    const refunded = agreements.filter((a) => {
        const s = normalize(a.status);
        return s === "cancelled" || s === "expired" || s === "refunded";
    }).length;

    const closed = completed + refunded;
    const successRate = closed ? Math.round((completed / closed) * 100) : 0;
    const disputeRate = total ? ((refunded / total) * 100).toFixed(1) : "0.0";
    const trustScore = Math.max(
        0,
        Math.min(100, Math.round(successRate * 0.85 + (100 - Number(disputeRate)) * 0.15))
    );

    const now = new Date();
    const thisMonth = agreements.filter((a) => {
        const ts = Number(a.created_time || 0) * 1000;
        const d = ts > 0 ? new Date(ts) : new Date(a.created_at || 0);
        return (
            d.getMonth() === now.getMonth() &&
            d.getFullYear() === now.getFullYear()
        );
    }).length;

    setText("stat-tokens", "0 LTT");
    setText("stat-agreements", String(total));
    setText(
        "stat-agreements-meta",
        `+${thisMonth} this month`
    );
    setText("stat-completed", String(completed));
    setText("stat-completed-meta", `${successRate}% success`);
    setText("stat-trust", `${trustScore}/100`);
    setText(
        "stat-trust-meta",
        trustScore >= 80 ? "Strong on-chain record" : "Keep completing agreements"
    );

    setText("trust-score-big", `${trustScore}/100`);
    const fill = document.getElementById("trust-bar-fill");
    if (fill) fill.style.width = `${trustScore}%`;

    setText("metric-ontime", `${successRate}%`);
    setText("metric-dispute", `${disputeRate}%`);
    setText("metric-active", String(active));

    // Role-specific reputation labels
    const metricLabels =
        document.querySelectorAll(".profile-metric span");

    if (metricLabels.length >= 3) {
        if (isCarrier) {
            metricLabels[0].innerText = "On-Time Deliveries";
            metricLabels[1].innerText = "Dispute / Refund Rate";
            metricLabels[2].innerText = "Active Agreements";
        } else {
            metricLabels[0].innerText = "Successful Completions";
            metricLabels[1].innerText = "Refund / Cancel Rate";
            metricLabels[2].innerText = "Active Shipments";
        }
    }

    const reputationTitle =
        document.querySelector(".profile-reputation-header h3");
    const reputationSub =
        document.querySelector(".profile-reputation-header p");

    if (!isCarrier) {
        if (reputationTitle) {
            reputationTitle.innerText =
                "Shipper Trust Score";
        }
        if (reputationSub) {
            reputationSub.innerText =
                "Based on completed shipments, refunds, and escrow reliability";
        }
    }
}

function setupEditModal(wallet) {
    const modal = document.getElementById("edit-profile-modal");
    const openBtn = document.getElementById("edit-profile-btn");
    const cancelBtn = document.getElementById("cancel-edit-btn");
    const saveBtn = document.getElementById("save-edit-btn");
    const message = document.getElementById("edit-message");

    if (!modal || !openBtn) return;

    openBtn.addEventListener("click", () => {
        modal.hidden = false;
        if (message) message.innerText = "";
    });

    cancelBtn?.addEventListener("click", () => {
        modal.hidden = true;
    });

    modal.addEventListener("click", (event) => {
        if (event.target === modal) modal.hidden = true;
    });

    saveBtn?.addEventListener("click", async () => {
        const name =
            document.getElementById("edit-name-input")?.value.trim() || "";
        const email =
            document.getElementById("edit-email-input")?.value.trim() || "";

        if (!name) {
            if (message) message.innerText = "Display name is required.";
            return;
        }

        if (message) message.innerText = "Saving...";

        localStorage.setItem("name", name);
        localStorage.setItem("profileEmail", email || "");

        try {
            const payload = {
                name,
                email: email || null
            };

            const { error } = await supabaseClient
                .from("users")
                .update(payload)
                .eq("wallet_address", wallet.toLowerCase());

            if (error) {
                // Email column may not exist — try name only
                const { error: nameError } = await supabaseClient
                    .from("users")
                    .update({ name })
                    .eq("wallet_address", wallet.toLowerCase());

                if (nameError) throw nameError;
            }

            if (message) message.innerText = "Saved.";
            modal.hidden = true;
            await loadProfile(wallet);
        } catch (error) {
            console.error(error);
            // Still update UI from localStorage even if Supabase schema lacks email
            setText("profile-name", name);
            setText("profile-email", email || "Not set");
            const avatar = document.getElementById("profile-avatar");
            if (avatar) avatar.innerText = getInitials(name);
            if (message) {
                message.innerText =
                    "Saved locally. Supabase update skipped or failed: " +
                    (error.message || String(error));
            }
            modal.hidden = true;
        }
    });
}

function setupChangePasswordModal() {
    const modal = document.getElementById("change-password-modal");
    const openBtn = document.getElementById("change-password-btn");
    const cancelBtn = document.getElementById("cancel-password-btn");
    const saveBtn = document.getElementById("save-password-btn");
    const message = document.getElementById("password-message");
    const currentInput = document.getElementById("current-password-input");
    const newInput = document.getElementById("new-password-input");
    const confirmInput = document.getElementById("confirm-password-input");

    if (!modal || !openBtn) return;

    function resetFields() {
        if (currentInput) currentInput.value = "";
        if (newInput) newInput.value = "";
        if (confirmInput) confirmInput.value = "";
        if (message) message.innerText = "";
    }

    openBtn.addEventListener("click", () => {
        resetFields();
        modal.hidden = false;
    });

    cancelBtn?.addEventListener("click", () => {
        modal.hidden = true;
    });

    modal.addEventListener("click", (event) => {
        if (event.target === modal) modal.hidden = true;
    });

    saveBtn?.addEventListener("click", async () => {
        const currentPassword = currentInput?.value || "";
        const newPassword = newInput?.value || "";
        const confirmPassword = confirmInput?.value || "";

        if (!currentProfileEmail) {
            if (message) {
                message.innerText =
                    "No login email on file for this account. Register or set an email in Edit Profile before changing your password.";
            }
            return;
        }

        if (!currentPassword) {
            if (message) message.innerText = "Enter your current password.";
            return;
        }

        if (newPassword.length < 8) {
            if (message) message.innerText = "New password must be at least 8 characters.";
            return;
        }

        if (newPassword !== confirmPassword) {
            if (message) message.innerText = "New passwords do not match.";
            return;
        }

        if (saveBtn) saveBtn.disabled = true;
        if (message) message.innerText = "Verifying current password...";

        try {
            const { data: matchingRow, error: verifyError } = await supabaseClient
                .from("users")
                .select("email")
                .eq("email", currentProfileEmail)
                .eq("password", currentPassword)
                .maybeSingle();

            if (verifyError) {
                throw verifyError;
            }

            if (!matchingRow) {
                throw new Error("Current password is incorrect.");
            }

            if (message) message.innerText = "Updating password...";

            const { error: updateError } = await supabaseClient
                .from("users")
                .update({ password: newPassword })
                .eq("email", currentProfileEmail);

            if (updateError) {
                throw updateError;
            }

            if (message) {
                message.innerText = "Password updated.";
                message.style.color = "#34d399";
            }

            setTimeout(() => {
                modal.hidden = true;
                resetFields();
                if (message) message.style.color = "";
            }, 1200);

        } catch (error) {
            console.error("Change password failed:", error);
            if (message) {
                message.innerText = error?.message || String(error);
                message.style.color = "";
            }
        } finally {
            if (saveBtn) saveBtn.disabled = false;
        }
    });
}


function getInitials(name) {
    const parts = String(name || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    if (!parts.length) return "LE";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
}

function normalize(value) {
    return String(value || "").trim().toLowerCase();
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.innerText = value;
}