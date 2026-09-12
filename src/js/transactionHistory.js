let allTransactions = [];
let allMilestones = [];
let allAgreements = [];
let currentFilter = "all";

document.addEventListener("DOMContentLoaded", async () => {
  console.log("Initializing Transaction History...");

  try {
    await initializeWallet();
    await loadTransactionHistory();
    initializeSearch();
    initializeFilters();
    console.log("Transaction History initialized successfully.");
  } catch (error) {
    console.error("Transaction History initialization failed:", error);

    showError(error.message);
  }
});

function configureRoleFilters() {
  const userRole = String(localStorage.getItem("role") || "").toLowerCase();
  const isCarrier = userRole === "2" || userRole === "carrier";
  const hiddenForCarrier = new Set([
    "funded",
    "cancelled",
    "refunded",
    "stake-forfeited",
  ]);
  const hiddenForShipper = new Set(["stake-locked", "stake-returned"]);
  const events = buildLedgerEvents();
  const selectedFilter = currentFilter;

  document.querySelectorAll(".transaction-filter-btn").forEach((button) => {
    const filter = button.dataset.filter || "all";
    const hiddenByRole = isCarrier
      ? hiddenForCarrier.has(filter)
      : hiddenForShipper.has(filter);
    let hasMatchingRecord = filter === "all";
    if (!hasMatchingRecord && !hiddenByRole) {
      currentFilter = filter;
      hasMatchingRecord = events.some((event) => matchesFilter(event));
    }

    button.style.display = hiddenByRole || !hasMatchingRecord ? "none" : "";
  });

  currentFilter = selectedFilter;
}

// initialize wallte
async function initializeWallet() {
  // CHECK METAMASK
  if (typeof window.ethereum === "undefined") {
    throw new Error("MetaMask is required.");
  }

  // get connected account
  const accounts = await window.ethereum.request({
    method: "eth_accounts",
  });

  if (!accounts || accounts.length === 0) {
    throw new Error("No MetaMask account connected.");
  }

  currentAccount = accounts[0].toLowerCase();

  // save consistency
  localStorage.setItem("wallet", currentAccount);
  console.log("Transaction History wallet:", currentAccount);
  updateWalletDisplay(currentAccount);
}

function updateWalletDisplay(address) {
  const walletElement = document.getElementById("top-wallet-address");

  if (!walletElement) {
    return;
  }

  walletElement.innerText = formatAddress(address);
}

// LOAD TRANSACTION HISTORY
async function loadTransactionHistory() {
  showLoading();
  const userRole = String(localStorage.getItem("role") || "").toLowerCase();
  const isCarrier = userRole === "2" || userRole === "carrier";

  // LOAD AGREEMENTS WHERE THE USER IS INVOLVED
  let agreementQuery = supabaseClient.from("agreements").select(`
            agreement_id,
            reference_no,
            shipper_address,
            carrier_address,
            escrow_amount,
            escrow_released,
            escrow_remaining,
            refunded_amount,
            status,
            current_milestone,
            created_time,
            accepted_at,
            completed_at,
            cancelled_at,
            expired_at,
            deadline
        `);

  if (isCarrier) {
    agreementQuery = agreementQuery.eq("carrier_address", currentAccount);
  } else {
    agreementQuery = agreementQuery.eq("shipper_address", currentAccount);
  }

  const { data: agreements, error: agreementError } =
    await agreementQuery.order("agreement_id", { ascending: false });

  if (agreementError) {
    throw agreementError;
  }

  allAgreements = agreements || [];
  const agreementIds = allAgreements.map((agreement) => agreement.agreement_id);

  // LOAD TRANSACTIONS STRICTLY BOUND TO USER ROLE & AGREEMENTS
  if (agreementIds.length > 0) {
    const { data: transactions, error: transactionError } =
      await TransactionRepository.query((query) => {
        let txQuery = query.select(
          `
                id,
                transaction_hash,
                agreement_id,
                event_type,
                actor_address,
                details,
                created_at
            `,
        )
          .in("agreement_id", agreementIds);

        if (isCarrier) {
          txQuery = txQuery.or(
            `actor_address.eq.${currentAccount},event_type.eq.MilestonePayout,event_type.eq.MilestoneVerified,event_type.eq.MilestoneRejected,event_type.eq.CarrierStakeReturned,event_type.eq.CarrierStakeForfeited`,
          );
        } else {
          txQuery = txQuery.or(
            `actor_address.eq.${currentAccount},event_type.eq.AgreementAccepted`,
          );
        }

        return txQuery.order("created_at", { ascending: false });
      });

    if (transactionError) {
      throw transactionError;
    }

    allTransactions = transactions || [];
  } else {
    allTransactions = [];
  }

  // LOAD MILESTONES FOR THESE AGREEMENTS
  if (agreementIds.length > 0) {
    const { data: milestones, error: milestoneError } = await supabaseClient
      .from("milestones")
      .select(
        `
                id,
                agreement_id,
                milestone_index,
                checkpoint,
                percentage,
                completed,
                verified,
                completed_at,
                verified_at
            `,
      )
      .in("agreement_id", agreementIds)
      .order("milestone_index", { ascending: true });

    if (milestoneError) {
      throw milestoneError;
    }

    allMilestones = milestones || [];
  } else {
    allMilestones = [];
  }
  configureRoleFilters();
  updateStatistics();
  renderLedger();
}

// UPDATE STATISTICS (ROLE-AWARE)
function updateStatistics() {
  const userRole = String(localStorage.getItem("role") || "").toLowerCase();
  const isCarrier = userRole === "2" || userRole === "carrier";

  const escrowBalance = allAgreements.reduce((total, agreement) => {
    const status = String(agreement.status || "").toLowerCase();

    if (status !== "created" && status !== "in progress") {
      return total;
    }
    return total + Number(agreement.escrow_remaining || 0);
  }, 0);

  const escrowElement = document.getElementById("escrow-balance");

  if (escrowElement) {
    escrowElement.innerText = escrowBalance.toFixed(3);
  }

  // RELEASED ETH (SPENT VS EARNED)
  const released = allAgreements.reduce((total, agreement) => {
    const status = String(agreement.status || "").toLowerCase();
    if (status === "cancelled") {
      return total;
    }
    if (status === "expired" && Number(agreement.refunded_amount || 0) > 0) {
      return (
        total +
        Math.max(
          0,
          Number(agreement.escrow_amount || 0) -
            Number(agreement.refunded_amount),
        )
      );
    }

    return total + Number(agreement.escrow_released || 0);
  }, 0);

  const earnedElement = document.getElementById("eth-earned");

  const earnedLabel = earnedElement
    ? earnedElement
        .closest(".transaction-stat-card")
        ?.querySelector(".stat-label")
    : null;

  if (earnedElement) {
    earnedElement.innerText = released.toFixed(3);

    if (isCarrier && earnedLabel) {
      earnedLabel.innerText = "ETH EARNED";
    }
  }

  // Only shippers see the money returned to them.
  // Cancelled agreements refund their full funded escrow; expired agreements refund whatever
  // remained after any carrier milestone payouts.
  const refundedCard = document.getElementById("eth-refunded-card");
  if (refundedCard) {
    refundedCard.style.display = isCarrier ? "none" : "flex";
  }
  document
    .querySelector(".transaction-stats-grid")
    ?.classList.toggle("has-refund-amount", !isCarrier);
  document
    .querySelector(".transaction-stats-grid")
    ?.classList.toggle("has-carrier-stats", isCarrier);
  document
    .querySelector(".transaction-stats-grid")
    ?.classList.toggle("has-shipper-stats", !isCarrier);

  const refunded = isCarrier
    ? 0
    : allAgreements.reduce((total, agreement) => {
        const status = String(agreement.status || "").toLowerCase();
        if (status !== "cancelled" && status !== "expired") return total;

        const recordedRefund = Number(agreement.refunded_amount || 0);
        const fallbackRefund =
          status === "cancelled"
            ? Number(agreement.escrow_amount || 0)
            : Math.max(
                0,
                Number(agreement.escrow_amount || 0) -
                  Number(agreement.escrow_released || 0),
              );

        return total + (recordedRefund || fallbackRefund);
      }, 0);

  const refundedElement = document.getElementById("eth-refunded");
  if (refundedElement) {
    refundedElement.innerText = refunded.toFixed(3);
  }

  const stakeLockedCard = document.getElementById("carrier-stake-locked-card");
  const stakeReturnedCard = document.getElementById(
    "carrier-stake-returned-card",
  );
  [stakeLockedCard, stakeReturnedCard].forEach((card) => {
    if (card) card.style.display = isCarrier ? "flex" : "none";
  });

  const getStakeAmount = (transaction) =>
    Number(
      transaction.details?.stake_amount ?? transaction.details?.amount ?? 0,
    );
  const stakeLocked = isCarrier
    ? allTransactions
        .filter(
          (transaction) => transaction.event_type === "CarrierStakeDeposited",
        )
        .reduce((total, transaction) => total + getStakeAmount(transaction), 0)
    : 0;
  const stakeReturned = isCarrier
    ? allTransactions
        .filter(
          (transaction) => transaction.event_type === "CarrierStakeReturned",
        )
        .reduce((total, transaction) => total + getStakeAmount(transaction), 0)
    : 0;

  const stakeLockedElement = document.getElementById("carrier-stake-locked");
  const stakeReturnedElement = document.getElementById(
    "carrier-stake-returned",
  );
  if (stakeLockedElement) stakeLockedElement.innerText = stakeLocked.toFixed(3);
  if (stakeReturnedElement)
    stakeReturnedElement.innerText = stakeReturned.toFixed(3);

  const shipperForfeitedCard = document.getElementById(
    "shipper-stake-forfeited-card",
  );
  if (shipperForfeitedCard)
    shipperForfeitedCard.style.display = isCarrier ? "none" : "flex";
  const shipperStakeForfeited = isCarrier
    ? 0
    : allTransactions
        .filter(
          (transaction) => transaction.event_type === "CarrierStakeForfeited",
        )
        .reduce((total, transaction) => total + getStakeAmount(transaction), 0);
  const shipperForfeitedElement = document.getElementById(
    "shipper-stake-forfeited",
  );
  if (shipperForfeitedElement) {
    shipperForfeitedElement.innerText = shipperStakeForfeited.toFixed(3);
  }

  // COMPLETED AGREEMENTS
  const completed = allAgreements.filter(
    (agreement) => agreement.status === "Completed",
  ).length;

  const totalAgreements = allAgreements.length;
  const completedRate = totalAgreements
    ? (completed / totalAgreements) * 100
    : 0;

  const completedElement = document.getElementById("completed-count");

  if (completedElement) {
    completedElement.innerText = completed;
  }

  const completedRateElement = document.getElementById("completed-rate");

  if (completedRateElement) {
    completedRateElement.innerText = `↗ ${completedRate.toFixed(1)}% rate`;
  }

  // REFUNDED / CANCELLED FOR SHIPPERS; EXPIRED FOR CARRIERS
  const terminalAgreements = allAgreements.filter((agreement) => {
    if (isCarrier) {
      return agreement.status === "Expired";
    }

    return (
      agreement.status === "Refunded" ||
      agreement.status === "Cancelled" ||
      agreement.status === "Expired"
    );
  }).length;

  const refundRate = totalAgreements
    ? (terminalAgreements / totalAgreements) * 100
    : 0;

  const refundElement = document.getElementById("refund-count");

  const refundLabel = refundElement
    ? refundElement
        .closest(".transaction-stat-card")
        ?.querySelector(".stat-label")
    : null;

  if (refundElement) {
    refundElement.innerText = terminalAgreements;

    if (refundLabel) {
      refundLabel.innerText = isCarrier ? "EXPIRED" : "REFUNDED / CANCELLED";
    }
  }

  const refundRateElement = document.getElementById("refund-rate");

  if (refundRateElement) {
    refundRateElement.innerText = `${refundRate.toFixed(1)}% of total`;
  }
}

// BUILD LEDGER
function buildLedgerEvents() {
  const events = [];

  allTransactions.forEach((transaction) => {
    const agreement = findAgreement(transaction.agreement_id);

    events.push({
      type: "transaction",
      date: transaction.created_at,
      agreement: agreement,
      transaction: transaction,
      milestone: null,
    });
  });

  // CANCELLED AGREEMENTS
  allAgreements.forEach((agreement) => {
    if (
      agreement.status &&
      String(agreement.status).toLowerCase() === "cancelled"
    ) {
      const hasCancellationTransaction = allTransactions.some((transaction) => {
        return (
          Number(transaction.agreement_id) === Number(agreement.agreement_id) &&
          String(transaction.event_type || "")
            .toLowerCase()
            .includes("cancel")
        );
      });

      if (!hasCancellationTransaction) {
        events.push({
          type: "agreement",
          date: agreement.cancelled_at || agreement.created_time,
          agreement: agreement,
          transaction: null,
          milestone: null,
          agreementAction: "Cancelled",
        });
      }
    }
  });

  // SORT

  events.sort((a, b) => {
    const dateA = new Date(a.date || 0).getTime();
    const dateB = new Date(b.date || 0).getTime();
    return dateB - dateA;
  });

  return events;
}

function renderLedger() {
  const tableBody = document.getElementById("transaction-table-body");

  if (!tableBody) {
    return;
  }

  const events = buildLedgerEvents();

  // FILTER
  const filteredEvents = events.filter((event) => matchesFilter(event));

  // EMPTY
  if (filteredEvents.length === 0) {
    tableBody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align:center;padding:40px;color:#8d99ae;">
                    <i class="fa-solid fa-clock-rotate-left" style="font-size:28px; margin-bottom:12px;"></i>
                    <br>
                    No transaction history found.
                </td>
            </tr>
        `;
    return;
  }

  // CREATE ROWS
  tableBody.innerHTML = "";

  filteredEvents.forEach((event) => {
    const row = document.createElement("tr");

    if (event.type === "transaction") {
      renderTransactionRow(row, event);
    } else {
      renderMilestoneRow(row, event);
    }

    tableBody.appendChild(row);
  });
}

// TRANSACTION ROW

function renderTransactionRow(row, event) {
  const transaction = event.transaction;
  const agreement = event.agreement;

  const date = formatDateTime(transaction.created_at);
  const reference = agreement
    ? agreement.reference_no
    : `Agreement #${transaction.agreement_id}`;

  let type = transaction.event_type || "Transaction";
  const amount = extractTransactionAmount(transaction, agreement);
  const status = getTransactionStatus(type);

  // Extract milestone index / checkpoint info from transaction details if available
  let detailsText = "—";
  if (transaction.details) {
    if (typeof transaction.details === "object") {
      detailsText =
        transaction.details.description ||
        transaction.details.status ||
        JSON.stringify(transaction.details);

      // If a milestone index exists in details, append it cleanly to the type name
      if (transaction.details.milestone_index !== undefined) {
        const milestoneNum = Number(transaction.details.milestone_index) + 1;
        type = `${type} (M${milestoneNum})`;
      }
    } else {
      detailsText = String(transaction.details);
    }
  }

  row.innerHTML = `
        <td>${escapeHtml(date)}</td>
        <td><strong>${escapeHtml(reference)}</strong></td>
        <td><span class="transaction-type-badge">${escapeHtml(type)}</span></td>
        <td>${escapeHtml(amount)}</td>
        <td style="color: #8d99ae; max-width: 250px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(detailsText)}">
            ${escapeHtml(detailsText)}
        </td>
        <td><span class="transaction-status ${getStatusClass(status)}">${escapeHtml(status)}</span></td>
        <td>
            <button class="view-btn" onclick="window.location.href='transactionDetails.html?id=${Number(transaction.id)}'">
                <i class="fa-regular fa-eye"></i> View
            </button>
        </td>
    `;
}

// MILESTONE ROW

function renderMilestoneRow(row, event) {
  const milestone = event.milestone;
  const agreement = event.agreement;

  const reference = agreement
    ? agreement.reference_no
    : `Agreement #${milestone.agreement_id}`;
  const date = formatDateTime(event.date);
  const action = event.milestoneAction;

  let detailsText = `Milestone ${milestone.milestone_index + 1}: ${milestone.checkpoint}`;

  row.innerHTML = `
        <td>${escapeHtml(date)}</td>
        <td><strong>${escapeHtml(reference)}</strong></td>
        <td><span class="transaction-type-badge">Milestone ${escapeHtml(String(milestone.milestone_index + 1))}</span></td>
        <td>${escapeHtml(milestone.percentage)}%</td>
        <td style="color: #8d99ae;">${escapeHtml(detailsText)}</td>
        <td>—</td>
        <td><span class="transaction-status status-completed">${escapeHtml(action)}</span></td>
    `;
}

// MATCH FILTER

function matchesFilter(event) {
  if (currentFilter === "all") {
    return true;
  }

  const type =
    event.type === "milestone"
      ? "completed"
      : (event.transaction?.event_type || "").toLowerCase();

  const agreement = event.agreement;

  if (currentFilter === "funded") {
    return type === "agreementcreated" || type === "escrowfunded";
  }

  const eventFilters = {
    accepted: "agreementaccepted",
    "stake-locked": "carrierstakedeposited",
    released: "milestonepayout",
    "stake-returned": "carrierstakereturned",
    "stake-forfeited": "carrierstakeforfeited",
    refunded: "escrowrefunded",
  };
  if (eventFilters[currentFilter]) {
    return type === eventFilters[currentFilter];
  }

  if (currentFilter === "pending") {
    return (
      type === "milestonecompletionsubmitted" ||
      type === "milestonesubmitted" ||
      type === "deadlineextensionrequested"
    );
  }

  if (currentFilter === "verified") {
    return (
      (type === "milestoneverified" || type === "milestonepayout") &&
      !type.includes("rejected")
    );
  }

  if (currentFilter === "extensions") {
    return (
      (type.includes("extension") || type.includes("extended")) &&
      !type.includes("rejected")
    );
  }

  if (currentFilter === "completed") {
    return type === "agreementcompleted" || agreement?.status === "Completed";
  }

  if (currentFilter === "rejected") {
    return type === "milestonerejected" || type === "deadlineextensionrejected";
  }

  if (currentFilter === "cancelled") {
    // Ensure it is strictly a cancellation and NOT an agreement creation record
    return (
      (type === "agreementcancelled" ||
        event.agreementAction === "Cancelled" ||
        agreement?.status === "Cancelled") &&
      !type.includes("created")
    );
  }

  if (currentFilter === "expired") {
    // Ensure it is strictly an expiration and NOT an agreement creation record
    return (
      (type === "agreementexpired" || agreement?.status === "Expired") &&
      !type.includes("created")
    );
  }

  return true;
}

// SEARCH

function initializeSearch() {
  const searchInput = document.getElementById("agreement-search");

  if (!searchInput) {
    return;
  }

  searchInput.addEventListener("input", () => {
    const query = searchInput.value.toLowerCase().trim();
    const rows = document.querySelectorAll("#transaction-table-body tr");
    rows.forEach((row) => {
      const text = row.innerText.toLowerCase();

      row.style.display = text.includes(query) ? "" : "none";
    });
  });
}

// FILTER BUTTONS

function initializeFilters() {
  const buttons = document.querySelectorAll(".transaction-filter-btn");
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("active"));
      button.classList.add("active");
      currentFilter = button.getAttribute("data-filter") || "all";
      renderLedger();
    });
  });
}

// FIND AGREEMENT

function findAgreement(agreementId) {
  return allAgreements.find(
    (agreement) => Number(agreement.agreement_id) === Number(agreementId),
  );
}

// EXTRACT TRANSACTION AMOUNT (ROLE-AWARE)

function extractTransactionAmount(transaction, agreement = null) {
  const details = transaction.details;
  const eventType = transaction.event_type;

  if (!details) {
    return "—";
  }

  if (typeof details === "object") {
    let amount = null;
    let isIncoming = false;

    if (details.escrow && details.escrow.amount !== undefined) {
      amount = Number(details.escrow.amount);
      isIncoming = false;
    } else if (details.escrow_amount !== undefined) {
      amount = Number(details.escrow_amount);
      isIncoming = false;
    } else if (details.escrow_refunded !== undefined) {
      amount = Number(details.escrow_refunded);
      isIncoming = true;

      if (eventType === "AgreementExpired" && amount === 0 && agreement) {
        amount = Math.max(
          0,
          Number(agreement.escrow_amount || 0) -
            Number(agreement.escrow_released || 0),
        );
      }
    } else if (
      eventType === "CarrierStakeDeposited" ||
      eventType === "CarrierStakeReturned" ||
      eventType === "CarrierStakeForfeited"
    ) {
      amount = Number(details.stake_amount ?? details.amount ?? 0);
      const userRole = String(localStorage.getItem("role") || "").toLowerCase();
      isIncoming =
        (eventType === "CarrierStakeReturned" &&
          (userRole === "carrier" || userRole === "2")) ||
        (eventType === "CarrierStakeForfeited" &&
          !(userRole === "carrier" || userRole === "2"));
    } else if (
      eventType === "MilestonePaid" ||
      eventType === "MilestonePayout" ||
      eventType === "MilestoneVerified"
    ) {
      amount = Number(details.amount || 0);
      const userRole = String(localStorage.getItem("role") || "").toLowerCase();
      isIncoming = userRole === "carrier" || userRole === "2";
    }

    if (amount !== null && !isNaN(amount)) {
      const formatted = amount.toFixed(3);
      return isIncoming ? `+ ${formatted}` : `- ${formatted}`;
    }
  }

  return "—";
}

// TRANSACTION STATUS

function getTransactionStatus(eventType) {
  const type = String(eventType).toLowerCase();

  if (type === "milestonerejected" || type === "deadlineextensionrejected") {
    return "Rejected";
  }
  if (type === "carrierstakedeposited") {
    return "Stake Locked";
  }
  if (type === "carrierstakereturned") {
    return "Stake Returned";
  }
  if (type === "carrierstakeforfeited") {
    return "Stake Forfeited";
  }
  if (type === "agreementaccepted") {
    return "Accepted";
  }
  if (type === "milestonepayout") {
    return "Released";
  }
  if (type === "milestoneverified") {
    return "Verified";
  }
  if (type === "milestonecompletionsubmitted") {
    return "Submitted";
  }
  if (type.includes("extension") || type.includes("extended")) {
    return "Extended";
  }
  if (type.includes("refund")) {
    return "Refunded";
  }
  if (type.includes("complete")) {
    return "Completed";
  }
  if (type.includes("cancel")) {
    return "Cancelled";
  }
  if (type.includes("expire")) {
    return "Expired";
  }
  if (type.includes("fund") || type.includes("created")) {
    return "Funded";
  }

  if (type.includes("stake")) {
    return "Recorded";
  }
  if (type.includes("submit")) {
    return "Submitted";
  }
  if (
    type.includes("verified") ||
    type.includes("payout") ||
    type.includes("release")
  ) {
    return "Verified";
  }

  return "Recorded";
}

// STATUS CSS CLASS

function getStatusClass(status) {
  switch (status) {
    case "Funded":
    case "Extended":
    case "Stake Locked":
      return "status-funded";
    case "Accepted":
      return "status-accepted";
    case "Stake Returned":
      return "status-stake-returned";
    case "Submitted":
      return "status-submitted";
    case "Verified":
    case "Released":
      return "status-verified";
    case "Completed":
      return "status-completed";
    case "Refunded":
      return "status-refunded";
    case "Cancelled":
    case "Rejected":
    case "Stake Forfeited":
      return "status-cancelled";
    case "Expired":
      return "status-expired";
    default:
      return "status-active";
  }
}

// FORMAT DATE/TIME

function formatDateTime(value) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// FORMAT WALLET ADDRESS
function formatAddress(address) {
  if (!address) {
    return "Unknown";
  }

  if (address.length < 12) {
    return escapeHtml(address);
  }

  return (
    escapeHtml(address.substring(0, 6)) +
    "..." +
    escapeHtml(address.substring(address.length - 4))
  );
}

// FORMAT TRANSACTION HASH

function formatHash(hash) {
  if (!hash) {
    return "—";
  }

  if (hash.length < 14) {
    return escapeHtml(hash);
  }

  return (
    escapeHtml(hash.substring(0, 8)) +
    "..." +
    escapeHtml(hash.substring(hash.length - 6))
  );
}

// BLOCKCHAIN EXPLORER

function buildExplorerUrl(hash) {
  if (!hash) {
    return "#";
  }

  return "#";
}

// LOADING

function showLoading() {
  const tableBody = document.getElementById("transaction-table-body");

  if (!tableBody) {
    return;
  }

  tableBody.innerHTML = `
        <tr>
            <td colspan="6" style="text-align:center;padding:40px;color:#8d99ae;">
                <i class="fa-solid fa-spinner fa-spin"></i>
                Loading transaction history...
            </td>
        </tr>
    `;
}

// ERROR

function showError(message) {
  const tableBody = document.getElementById("transaction-table-body");

  if (!tableBody) {
    return;
  }

  tableBody.innerHTML = `
        <tr>
            <td colspan="6" style="text-align:center;padding:40px;color:#ef4444;">
                <i class="fa-solid fa-triangle-exclamation"></i>
                <br><br>
                ${escapeHtml(message)}
            </td>
        </tr>
    `;
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
