let allAgreements = [];
let filteredAgreements = [];

document.addEventListener("DOMContentLoaded", async () => {
  try {
    await loadAgreements();

    await processExpiredAgreements();

    await loadAgreements();

    setupFilters();
    setupSearch();

    renderAgreements();
  } catch (error) {
    console.error("Agreements page failed:", error);

    showAgreementsError(error.message || String(error));
  }
});

// LOAD AGREEMENTS

async function loadAgreements() {
  const currentWallet = localStorage.getItem("wallet");
  const userRole = localStorage.getItem("role");

  const { data: rawAgreements, error } = await supabaseClient
    .from("agreements")
    .select("*")
    .eq("chain_id", ACTIVE_CHAIN_ID)
    .order("agreement_id", {
      ascending: false,
    });

  if (error) {
    throw error;
  }

  // Strict Role-Based Post-Filtering
  let agreements = rawAgreements || [];
  const roleStr = String(userRole || "").toLowerCase();
  const isCarrierUser = roleStr === "2" || roleStr === "carrier";
  const isShipperUser = roleStr === "1" || roleStr === "shipper";

  const newAgreementBtn = document.getElementById("new-agreement-btn");
  if (newAgreementBtn) {
    if (isCarrierUser) {
      newAgreementBtn.style.display = "none"; // Hide button for carriers
    } else {
      newAgreementBtn.style.display = "flex"; // Show for shippers
    }
  }

  if (isShipperUser && currentWallet) {
    const walletLower = currentWallet.toLowerCase();
    agreements = agreements.filter(
      (a) =>
        a.shipper_address && a.shipper_address.toLowerCase() === walletLower,
    );
  } else if (isCarrierUser && currentWallet) {
    const walletLower = currentWallet.toLowerCase();
    agreements = agreements.filter((a) => {
      const status = String(a.status || "").toLowerCase();
      if (status === "created") {
        // Do not offer a carrier an agreement whose deadline has
        // already passed but is still awaiting shipper-confirmed expiry.
        return !isAgreementPastDeadline(a);
      }
      if (status === "in progress") {
        return (
          a.carrier_address && a.carrier_address.toLowerCase() === walletLower
        );
      }
      return (
        a.carrier_address && a.carrier_address.toLowerCase() === walletLower
      );
    });
  }

  allAgreements = agreements;

  // Load blockchain state

  if (typeof window.ethereum !== "undefined") {
    const web3 = new Web3(window.ethereum);

    const contract = new web3.eth.Contract(CONTRACT_ABI, CONTRACT_ADDRESS);

    for (let i = 0; i < allAgreements.length; i++) {
      const agreement = allAgreements[i];

      try {
        const chainAgreement = await contract.methods
          .getAgreementBasic(Number(agreement.agreement_id))
          .call();

        agreement.blockchain_escrow = chainAgreement.escrowAmount;
        agreement.blockchain_escrow_remaining = chainAgreement.escrowRemaining;
        agreement.blockchain_shipper = chainAgreement.shipper;
        agreement.blockchain_carrier = chainAgreement.carrier;
        agreement.blockchain_status = Number(chainAgreement.status);
        agreement.blockchain_current_milestone = Number(
          chainAgreement.currentMilestone,
        );

        agreement.blockchain_deadline = Number(chainAgreement.deadline);
      } catch (error) {
        console.warn(
          `Could not load blockchain agreement ${agreement.agreement_id}:`,
          error,
        );
      }
    }
  }

  // Re-check after the on-chain deadline has been loaded, since blockchain
  // state is authoritative for carrier-visible Created agreements.
  if (isCarrierUser) {
    allAgreements = allAgreements.filter(
      (agreement) =>
        !(
          getEffectiveStatus(agreement) === "Created" &&
          isAgreementPastDeadline(agreement)
        ),
    );
  }

  await loadCarrierExtensionRejections(isCarrierUser);
}

async function loadCarrierExtensionRejections(isCarrierUser) {
  if (!isCarrierUser || allAgreements.length === 0) return;
  const ids = allAgreements.map((agreement) => Number(agreement.agreement_id));
  const { data, error } = await supabaseClient
    .from("transactions")
    .select("agreement_id, details, created_at")
    .in("agreement_id", ids)
    .eq("chain_id", ACTIVE_CHAIN_ID)
    .eq("event_type", "DeadlineExtensionRejected")
    .order("created_at", { ascending: false });
  if (error) {
    console.warn("Could not load extension rejection notices:", error);
    return;
  }
  allAgreements.forEach((agreement) => {
    agreement.extensionRejection = (data || []).find(
      (item) => Number(item.agreement_id) === Number(agreement.agreement_id),
    );
  });
}

function isAgreementPastDeadline(agreement) {
  const deadline = Number(
    agreement?.blockchain_deadline || agreement?.deadline || 0,
  );

  return deadline > 0 && Math.floor(Date.now() / 1000) > deadline;
}

// PROCESS EXPIRED AGREEMENTS
// - Expired agreement is detected and the Shipper is asked to confirm
// - expireAgreement() is called by the Shipper
// - Smart contract refunds Shipper
// - Supabase status becomes Expired

async function processExpiredAgreements() {
  if (typeof window.ethereum === "undefined") {
    console.warn("MetaMask unavailable. Cannot process blockchain expiry.");

    return;
  }

  const web3 = new Web3(window.ethereum);
  const contract = new web3.eth.Contract(CONTRACT_ABI, CONTRACT_ADDRESS);
  const now = Math.floor(Date.now() / 1000);

  for (const agreement of allAgreements) {
    const deadline = Number(
      agreement.blockchain_deadline || agreement.deadline || 0,
    );

    if (!deadline) {
      continue;
    }

    // Not expired
    if (now <= deadline) {
      continue;
    }

    const blockchainStatus = Number(agreement.blockchain_status);

    // Completed

    if (blockchainStatus === 2) {
      continue;
    }

    // Cancelled

    if (blockchainStatus === 3) {
      continue;
    }

    // Already expired

    if (blockchainStatus === 4) {
      await syncExpiredAgreement(agreement, null, null);

      continue;
    }

    // Need to expire

    try {
      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });

      if (!accounts || accounts.length === 0) {
        console.warn("No wallet connected. Cannot expire agreement.");

        continue;
      }

      const account = accounts[0];

      // Re-check blockchain state

      const chainAgreement = await contract.methods
        .getAgreementBasic(Number(agreement.agreement_id))
        .call();

      const currentStatus = Number(chainAgreement.status);

      if (currentStatus === 2 || currentStatus === 3) {
        continue;
      }

      if (currentStatus === 4) {
        agreement.blockchain_status = 4;

        await syncExpiredAgreement(agreement, null, null);

        continue;
      }

      const chainDeadline = Number(chainAgreement.deadline);

      if (now <= chainDeadline) {
        continue;
      }

      // Expiry is a shipper-confirmed transaction. A carrier can see
      // the expired agreement, but must never be asked to sign it.
      if (account.toLowerCase() !== chainAgreement.shipper.toLowerCase()) {
        continue;
      }

      // Expiry transaction

      const confirmed = confirm(
        `Agreement ${agreement.reference_no} has expired.\n\n` +
          "As the Shipper, confirm the expiry transaction to refund the remaining escrow to your wallet.\n\n" +
          "Process expiry now?",
      );

      if (!confirmed) {
        continue;
      }

      // Capture the remaining escrow before expireAgreement() clears it
      // on-chain. This is the exact amount refunded to the Shipper.
      const refundedAmount = getBlockchainEth(
        chainAgreement.escrowRemaining,
        agreement.escrow_remaining,
      );

      // The contract clears carrierStake during expiry, so calculate the
      // guaranteed 30% forfeiture from the pre-expiry agreement state.
      const stakeForfeited =
        currentStatus === 1
          ? getBlockchainEth(
              chainAgreement.escrowAmount,
              agreement.escrow_amount,
            ) * 0.3
          : 0;

      const tx = await contract.methods
        .expireAgreement(Number(agreement.agreement_id))
        .send({
          from: account,
        });

      console.log(
        `Agreement ${agreement.agreement_id} expired:`,
        tx.transactionHash,
      );

      await syncExpiredAgreement(
        agreement,
        tx.transactionHash,
        account,
        refundedAmount,
        stakeForfeited,
      );

      const stakeMessage = stakeForfeited > 0
        ? `Carrier stake forfeited to you: ${stakeForfeited.toFixed(3)} ETH\n\n`
        : "";
      alert(
        `Agreement ${agreement.reference_no} expired successfully!\n\n` +
          `Remaining escrow refunded: ${refundedAmount.toFixed(3)} ETH\n\n` +
          stakeMessage +
          "The expiry record is now in transaction history.",
      );
    } catch (error) {
      console.error(
        `Could not expire agreement ${agreement.agreement_id}:`,
        error,
      );

      if (error?.code === 4001) {
        alert(
          `Agreement ${agreement.reference_no} expiry failed:\n\nTransaction was rejected in MetaMask.`,
        );
      }
    }
  }
}

// SYNC EXPIRED AGREEMENT

async function syncExpiredAgreement(
  agreement,
  transactionHash,
  actor,
  refundedAmount = null,
  stakeForfeited = 0,
) {
  try {
    const remaining =
      refundedAmount ??
      getBlockchainEth(
        agreement.blockchain_escrow_remaining,
        agreement.escrow_remaining,
      );

    const { error } = await supabaseClient
      .from("agreements")
      .update({
        status: "Expired",
        expired_at: Math.floor(Date.now() / 1000),
        refunded_amount: remaining,
        escrow_remaining: 0,
        // A shipper refund is not a carrier payout.
        escrow_released: Number(agreement.escrow_released || 0),
      })
      .eq("agreement_id", Number(agreement.agreement_id))
      .eq("chain_id", ACTIVE_CHAIN_ID);

    if (error) {
      console.error("Failed to synchronize expired agreement:", error);

      return;
    }

    agreement.status = "Expired";
    agreement.expired_at = Math.floor(Date.now() / 1000);
    agreement.escrow_remaining = 0;
    agreement.refunded_amount = remaining;

    // Transaction record

    if (transactionHash && actor) {
      await supabaseClient.from("transactions").insert([
        {
          transaction_hash: transactionHash,
          agreement_id: Number(agreement.agreement_id),
          chain_id: ACTIVE_CHAIN_ID,
          event_type: "AgreementExpired",
          actor_address: actor.toLowerCase(),
          details: {
            status: "Expired",
            escrow_refunded: remaining,
            description:
              "Agreement expired after the deadline. Remaining escrow was refunded to the Shipper.",
          },
        },
        ...(stakeForfeited > 0
          ? [
              {
                transaction_hash: `${transactionHash}:carrier-stake-forfeited`,
                agreement_id: Number(agreement.agreement_id),
                chain_id: ACTIVE_CHAIN_ID,
                event_type: "CarrierStakeForfeited",
                actor_address: actor.toLowerCase(),
                details: {
                  amount: stakeForfeited,
                  stake_amount: stakeForfeited,
                  blockchain_transaction_hash: transactionHash,
                  description: `${stakeForfeited.toFixed(3)} ETH carrier performance stake was forfeited to the Shipper after the deadline.`,
                },
              },
            ]
          : []),
      ]);
    }
  } catch (error) {
    console.error("Expired agreement synchronization failed:", error);
  }
}

// FILTERS

function setupFilters() {
  const role = String(localStorage.getItem("role") || "").toLowerCase();
  if (role === "2" || role === "carrier") {
    document.querySelector('.filter-btn[data-filter="cancelled"]')?.remove();
  }

  document.querySelectorAll(".filter-btn").forEach((button) => {
    button.addEventListener("click", () => {
      document
        .querySelectorAll(".filter-btn")
        .forEach((btn) => btn.classList.remove("active"));

      button.classList.add("active");

      renderAgreements();
    });
  });
}

// SEARCH

function setupSearch() {
  const searchInputs = [
    document.getElementById("search-input"),

    document.getElementById("table-search-input"),
  ];

  searchInputs.forEach((input) => {
    if (!input) {
      return;
    }

    input.addEventListener("input", renderAgreements);
  });
}

// RENDER

function renderAgreements() {
  renderExtensionRequestBar();
  renderExtensionRejectionReminder();

  const tbody = document.getElementById("agreements-table-body");

  if (!tbody) {
    return;
  }

  const activeFilter =
    document.querySelector(".filter-btn.active")?.dataset.filter || "all";

  const searchValue = (
    document.getElementById("table-search-input")?.value ||
    document.getElementById("search-input")?.value ||
    ""
  )
    .trim()
    .toLowerCase();

  filteredAgreements = allAgreements.filter((agreement) => {
    const status = getEffectiveStatus(agreement);
    const reference = String(agreement.reference_no || "").toLowerCase();
    const payload = String(agreement.payload_value || "").toLowerCase();
    const searchMatch =
      !searchValue ||
      reference.includes(searchValue) ||
      payload.includes(searchValue);

    const filterMatch =
      activeFilter === "all" ||
      status.toLowerCase() === activeFilter.toLowerCase();

    return (
      searchMatch &&
      filterMatch &&
      !(
        String(localStorage.getItem("role") || "").toLowerCase() ===
          "carrier" &&
        status === "Created" &&
        isAgreementPastDeadline(agreement)
      )
    );
  });

  tbody.innerHTML = "";

  if (filteredAgreements.length === 0) {
    tbody.innerHTML = `
            <tr>
                <td
                    colspan="9"
                    style="
                        text-align:center;
                        color:#8d99ae;
                        padding:30px;
                    "
                >
                    No agreements found.
                </td>
            </tr>
        `;

    return;
  }

  filteredAgreements.forEach((agreement) => {
    const status = getEffectiveStatus(agreement);
    const shipper = agreement.blockchain_shipper || agreement.shipper_address;
    const carrier = agreement.blockchain_carrier || agreement.carrier_address;
    const escrow = ["cancelled", "expired"].includes(
      String(status).toLowerCase(),
    )
      ? // Terminal refund actions clear the on-chain balance after
        // returning it to the shipper. The list should still show
        // the escrow that the shipper originally funded.
        Number(agreement.escrow_amount || 0)
      : getBlockchainEth(agreement.blockchain_escrow, agreement.escrow_amount);

    const deadline = Number(
      agreement.blockchain_deadline || agreement.deadline,
    );

    // ACTION BUTTONS DEFINITION

    const userRole = localStorage.getItem("role") || "";
    const currentWallet = (localStorage.getItem("wallet") || "").toLowerCase();

    const isCarrierUser =
      userRole === "2" || userRole.toLowerCase() === "carrier";
    const isShipperUser =
      userRole === "1" || userRole.toLowerCase() === "shipper";

    const isCreated = status === "Created";
    const isOwnerShipper = shipper && shipper.toLowerCase() === currentWallet;

    let actionButtons = `
                <button
                    class="view-btn"
                    onclick="viewAgreement(${Number(agreement.agreement_id)})"
                >
                    <i class="fa-regular fa-eye"></i>
                    View
                </button>
            `;

    // Carrier Accept button
    if (isCarrierUser && isCreated && !isAgreementPastDeadline(agreement)) {
      actionButtons += `
                    <button
                        class="accept-btn"
                        style="margin-left: 5px;"
                        onclick="acceptAgreementAction(${Number(agreement.agreement_id)})"
                    >
                        <i class="fa-solid fa-check"></i>
                        Accept
                    </button>
                `;
    }

    // Shipper Cancel button (Only for created agreements they own)
    if (isShipperUser && isCreated && isOwnerShipper) {
      actionButtons += `
                    <button
                        class="cancel-btn"
                        style="margin-left: 5px;"
                        onclick="cancelAgreementAction(${Number(agreement.agreement_id)})"
                    >
                        <i class="fa-solid fa-xmark"></i>
                        Cancel
                    </button>
                `;
    }

    const row = document.createElement("tr");

    row.innerHTML = `
                <td>
                    ${escapeHtml(agreement.reference_no)}
                </td>

                <td>
                    ${shortenAddress(shipper)}
                </td>

                <td>
                    ${shortenAddress(carrier)}
                </td>

                <td>
                    $${Number(agreement.payload_value || 0).toLocaleString(
                      undefined,
                      {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      },
                    )}
                </td>

                <td>
                    ${escapeHtml(agreement.priority || "Normal")}
                </td>

                <td>
                    ${escrow.toFixed(3)} ETH
                </td>

                <td>
                    ${formatDate(deadline)}
                </td>

                <td>
                    <span
                        class="status-badge ${getStatusClass(status)}"
                    >
                        <span class="status-dot"></span>
                        ${escapeHtml(status)}
                    </span>
                </td>

                 <td>
                    ${actionButtons}
                </td>
            `;

    tbody.appendChild(row);
  });
}

function renderExtensionRejectionReminder() {
  const bar = document.getElementById("extension-rejected-reminder-bar");
  const detail = document.getElementById("extension-rejected-bar-details");
  const dismissButton = document.getElementById("dismiss-extension-rejected-btn");
  const role = String(localStorage.getItem("role") || "").toLowerCase();
  const rejected = allAgreements.find(
    (agreement) =>
      agreement.extensionRejection &&
      !localStorage.getItem(getExtensionRejectionAcknowledgementKey(agreement)),
  );
  if (!bar || !detail || (role !== "2" && role !== "carrier") || !rejected) {
    if (bar) bar.style.display = "none";
    return;
  }
  detail.textContent = `Your extension request for ${rejected.reference_no} was rejected.`;
  if (dismissButton) {
    dismissButton.onclick = () => {
      localStorage.setItem(getExtensionRejectionAcknowledgementKey(rejected), "true");
      bar.style.display = "none";
    };
  }
  bar.style.display = "block";
}

function getExtensionRejectionAcknowledgementKey(agreement) {
  return `extension-rejection-acknowledged:${agreement.agreement_id}:${agreement.extensionRejection?.created_at || "unknown"}`;
}

// SHIPPER EXTENSION REQUEST BAR

function renderExtensionRequestBar() {
  const bar = document.getElementById("extension-notification-bar");
  const role = String(localStorage.getItem("role") || "")
    .toLowerCase()
    .trim();
  const wallet = String(localStorage.getItem("wallet") || "").toLowerCase();

  if (!bar || (role !== "1" && role !== "shipper") || !wallet) {
    if (bar) bar.style.display = "none";
    return;
  }

  const requestedAgreement = allAgreements.find((agreement) => {
    const hasPendingRequest =
      agreement.extension_requested_deadline !== null &&
      agreement.extension_requested_deadline !== undefined &&
      String(agreement.extension_requested_deadline).trim() !== "";

    return (
      hasPendingRequest &&
      String(agreement.shipper_address || "").toLowerCase() === wallet &&
      getEffectiveStatus(agreement) === "In Progress"
    );
  });

  if (!requestedAgreement) {
    bar.style.display = "none";
    return;
  }

  const detail = document.getElementById("extension-bar-details");
  const approveButton = document.getElementById("bar-approve-ext-btn");
  const rejectButton = document.getElementById("bar-reject-ext-btn");
  const requestedDeadline = Number(
    requestedAgreement.extension_requested_deadline,
  );

  if (detail) {
    detail.textContent =
      `Carrier requested a deadline extension for ${
        requestedAgreement.reference_no
      } until ${formatDateTime(requestedDeadline)}. ` +
      `Reason: ${
        requestedAgreement.extension_request_reason || "No reason provided."
      }`;
  }

  if (approveButton) {
    approveButton.onclick = () =>
      approveDeadlineExtension(requestedAgreement.agreement_id);
  }

  if (rejectButton) {
    rejectButton.onclick = () =>
      rejectDeadlineExtension(requestedAgreement.agreement_id);
  }

  bar.style.display = "block";
}

async function approveDeadlineExtension(agreementId) {
  const agreement = allAgreements.find(
    (item) => Number(item.agreement_id) === Number(agreementId),
  );

  if (!agreement) {
    alert("Agreement not found.");
    return;
  }

  await sharedApproveExtension(
    agreementId,
    agreement.reference_no,
    agreement.extension_requested_deadline,
    () => window.location.reload(),
  );
}

async function rejectDeadlineExtension(agreementId) {
  const agreement = allAgreements.find(
    (item) => Number(item.agreement_id) === Number(agreementId),
  );

  if (!agreement) {
    alert("Agreement not found.");
    return;
  }

  await sharedRejectExtension(agreementId, agreement.reference_no, () =>
    window.location.reload(),
  );
}

async function acceptAgreementAction(agreementId) {
  const targetAgreement = allAgreements.find(
    (a) => Number(a.agreement_id) === Number(agreementId),
  );

  if (isAgreementPastDeadline(targetAgreement)) {
    alert(
      "This agreement has passed its deadline and is awaiting the Shipper's expiry confirmation.",
    );
    return;
  }

  const currentWallet = (localStorage.getItem("wallet") || "").toLowerCase();
  const shipperAddress = (
    targetAgreement?.blockchain_shipper ||
    targetAgreement?.shipper_address ||
    ""
  ).toLowerCase();

  if (shipperAddress && currentWallet === shipperAddress) {
    alert(
      "Action Denied: Shippers cannot accept their own logistics agreements as carriers.",
    );
    return;
  }

  await sharedAcceptAgreement(agreementId, targetAgreement?.reference_no, () =>
    window.location.reload(),
  );
}

// SHIPPER CANCEL AGREEMENT FROM LISTING PAGE

async function cancelAgreementAction(agreementId) {
  const targetAgreement = allAgreements.find(
    (a) => Number(a.agreement_id) === Number(agreementId),
  );
  const refund = Number(
    targetAgreement?.escrow_remaining || targetAgreement?.escrow_amount || 0,
  );

  await sharedCancelAgreement(
    agreementId,
    targetAgreement?.reference_no,
    refund,
    targetAgreement?.status,
    () => window.location.reload(),
  );
}

// EFFECTIVE STATUS

function getEffectiveStatus(agreement) {
  // Blockchain is authoritative
  const blockchainStatus = Number(agreement.blockchain_status);

  switch (blockchainStatus) {
    case 0:
      return "Created";

    case 1:
      return "In Progress";

    case 2:
      return "Completed";

    case 3:
      return "Cancelled";

    case 4:
      return "Expired";
  }

  // Fallback deadline check

  const deadline = Number(
    agreement.blockchain_deadline || agreement.deadline || 0,
  );

  if (
    deadline &&
    Math.floor(Date.now() / 1000) > deadline &&
    agreement.status !== "Completed" &&
    agreement.status !== "Cancelled"
  ) {
    return "Expired";
  }

  return agreement.status || "Created";
}

// VIEW AGREEMENT

function viewAgreement(id) {
  window.location.href = `agreementDetails.html?id=${Number(id)}`;
}

// HELPERS

function getBlockchainEth(weiValue, fallbackEth) {
  if (weiValue !== undefined && weiValue !== null) {
    try {
      return Number(Web3.utils.fromWei(weiValue.toString(), "ether"));
    } catch (error) {
      console.warn("Wei conversion failed:", error);
    }
  }

  return Number(fallbackEth || 0);
}

function shortenAddress(address) {
  if (
    !address ||
    address.trim() === "" ||
    address.toLowerCase() === "0x0000000000000000000000000000000000000000"
  ) {
    return '<span class="text-muted" style="font-style: italic;">Unassigned</span>';
  }

  if (address.length < 12) {
    return address;
  }

  return (
    address.substring(0, 6) + "..." + address.substring(address.length - 4)
  );
}

function formatDate(timestamp) {
  if (!timestamp) {
    return "-";
  }

  return new Date(Number(timestamp) * 1000).toLocaleDateString("en-US", {
    year: "numeric",

    month: "long",

    day: "numeric",
  });
}

function formatDateTime(timestamp) {
  if (!timestamp) {
    return "-";
  }

  return new Date(Number(timestamp) * 1000).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getStatusClass(status) {
  switch (status) {
    case "Created":
      return "status-available";

    case "In Progress":
      return "status-active";

    case "Completed":
      return "status-completed";

    case "Cancelled":
      return "status-cancelled";

    case "Expired":
      return "status-expired";

    default:
      return "status-active";
  }
}

function escapeHtml(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function showAgreementsError(message) {
  const tbody = document.getElementById("agreements-table-body");

  if (!tbody) {
    return;
  }

  tbody.innerHTML = `
        <tr>
            <td
                colspan="9"
                style="
                    text-align:center;
                    color:#ef4444;
                    padding:30px;
                "
            >
                <i class="fa-solid fa-circle-exclamation"></i>
                ${escapeHtml(message)}
            </td>
        </tr>
    `;
}
