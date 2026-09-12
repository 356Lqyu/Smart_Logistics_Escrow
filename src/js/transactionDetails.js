document.addEventListener("DOMContentLoaded", async () => {
  try {
    const params = new URLSearchParams(window.location.search);
    const txHash = params.get("hash");
    const txId = params.get("id");

    if (!txHash && !txId) {
      throw new Error("No transaction identifier was provided.");
    }

    const { data: transaction, error } = await TransactionRepository.query(
      (query) => {
        const filteredQuery = txId
          ? query.select("*").eq("id", Number(txId))
          : query.select("*").eq("transaction_hash", txHash);
        return filteredQuery.maybeSingle();
      },
    );
    if (error) throw error;
    if (!transaction) throw new Error("Transaction record not found.");

    let agreementRef = "—";
    if (transaction.agreement_id) {
      const { data: agreement } = await supabaseClient
        .from("agreements")
        .select("reference_no")
        .eq("agreement_id", Number(transaction.agreement_id))
        .maybeSingle();
      if (agreement) agreementRef = agreement.reference_no;
    }

    document.getElementById("tx-event-type").innerText =
      transaction.event_type || "Transaction";

    const status = getTransactionStatus(transaction.event_type);
    const statusEl = document.getElementById("tx-status");
    if (statusEl) {
      statusEl.innerHTML = `<span class="status-dot"></span>${escapeHtml(status)}`;
      statusEl.className = "status-badge " + getStatusClass(status);
    }

    const rawTxHash =
      transaction.details?.blockchain_transaction_hash ||
      transaction.transaction_hash;
    const hashContainer = document.getElementById("tx-hash");
    if (hashContainer) {
      if (rawTxHash && !rawTxHash.startsWith("N/A")) {
        const explorerUrl = buildExplorerUrl(rawTxHash);
        hashContainer.innerHTML = `<a href="${explorerUrl}" target="_blank" rel="noopener noreferrer" class="transaction-hash" style="color: #38bdf8; text-decoration: underline;">${escapeHtml(rawTxHash)}</a>`;
      } else {
        hashContainer.innerText = rawTxHash || "—";
      }
    }

    document.getElementById("tx-agreement-ref").innerText = agreementRef;
    document.getElementById("tx-timestamp").innerText = formatDateTime(
      transaction.created_at,
    );

    const detailsObj = transaction.details || {};
    document.getElementById("tx-description").innerText =
      detailsObj.description || detailsObj.status || "No description provided.";

    const amountContainer = document.getElementById("tx-amount-wrapper");
    const amountVal = extractTransactionAmount(transaction);
    if (amountContainer) {
      if (amountVal && amountVal !== "—") {
        document.getElementById("tx-amount").innerText = amountVal;
        amountContainer.style.display = "block";
      } else {
        amountContainer.style.display = "none";
      }
    }

    document.getElementById("details-loading").style.display = "none";
    document.getElementById("transaction-content").style.display = "block";
  } catch (err) {
    console.error("Failed to load transaction details:", err);
    document.getElementById("details-loading").style.display = "none";
    const errEl = document.getElementById("details-error");
    if (errEl) {
      errEl.style.display = "block";
      errEl.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> ${escapeHtml(err.message || String(err))}`;
    }
  }
});

function extractTransactionAmount(transaction) {
  const details = transaction.details;
  const eventType = transaction.event_type;

  if (!details || typeof details !== "object") return "—";

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

  if (amount !== null && !isNaN(amount) && amount > 0) {
    const formatted = amount.toFixed(3);
    return isIncoming ? `+ ${formatted} ETH` : `- ${formatted} ETH`;
  }

  return "—";
}

function getTransactionStatus(eventType) {
  const type = String(eventType || "").toLowerCase();
  if (type.includes("rejected")) return "Rejected";
  if (type.includes("extension") || type.includes("extended"))
    return "Extended";
  if (type.includes("refund")) return "Refunded";
  if (type.includes("complete")) return "Completed";
  if (type.includes("cancel")) return "Cancelled";
  if (type.includes("expire")) return "Expired";
  if (type.includes("fund") || type.includes("created")) return "Funded";
  if (type.includes("stake")) return "Recorded";
  if (type.includes("submit")) return "Submitted";
  if (
    type.includes("verified") ||
    type.includes("payout") ||
    type.includes("release")
  )
    return "Verified";
  return "Recorded";
}

function getStatusClass(status) {
  switch (status) {
    case "Funded":
    case "Extended":
      return "status-funded";
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
      return "status-cancelled";
    case "Expired":
      return "status-expired";
    default:
      return "status-active";
  }
}

function buildExplorerUrl(hash) {
  if (!hash || hash.startsWith("N/A")) {
    return "#";
  }
  return `https://sepolia.etherscan.io/tx/${hash}`;
}

function formatDateTime(val) {
  if (!val) return "—";
  const d = new Date(val);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function escapeHtml(val) {
  if (val === null || val === undefined) return "";
  return String(val)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
