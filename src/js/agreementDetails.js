let agreementId = null;
let agreementData = null;
let milestoneData = [];
let rejectionTransactionsMap = {};

document.addEventListener("DOMContentLoaded", async () => {
  try {
    const params = new URLSearchParams(window.location.search);

    agreementId = params.get("id");

    if (!agreementId) {
      throw new Error("No agreement ID was provided.");
    }

    await loadAgreement();
    await processAgreementExpiry();
    await loadAgreement();
    await loadMilestones();
    renderAgreement();
    renderMilestones();
    renderLifecycle();
    setupActions();

    document.getElementById("details-loading").style.display = "none";
    document.getElementById("agreement-content").style.display = "block";
  } catch (error) {
    console.error("Agreement details failed:", error);

    showError(error.message || String(error));
  }
});

async function loadAgreement() {
  const { data, error } = await supabaseClient
    .from("agreements")
    .select("*")
    .eq("agreement_id", Number(agreementId))
    .single();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error("Agreement was not found.");
  }

  agreementData = data;

  if (typeof window.ethereum !== "undefined") {
    try {
      const web3 = new Web3(window.ethereum);

      const contract = new web3.eth.Contract(CONTRACT_ABI, CONTRACT_ADDRESS);

      const chainAgreement = await contract.methods
        .getAgreementBasic(Number(agreementId))
        .call();

      agreementData.blockchain_escrow = chainAgreement.escrowAmount;
      agreementData.blockchain_escrow_remaining =
        chainAgreement.escrowRemaining;
      agreementData.blockchain_shipper = chainAgreement.shipper;
      agreementData.blockchain_carrier = chainAgreement.carrier;
      agreementData.blockchain_status = Number(chainAgreement.status);
      agreementData.blockchain_current_milestone = Number(
        chainAgreement.currentMilestone,
      );
      agreementData.blockchain_deadline = Number(chainAgreement.deadline);
    } catch (error) {
      console.warn("Could not load blockchain agreement:", error);
    }
  }
}

// PROCESS AGREEMENT EXPIRY
// Expiry is determined by the blockchain deadline.
// If: current time > deadline
// and the blockchain agreement is not already Completed,
// call expireAgreement()

async function processAgreementExpiry() {
  if (!agreementData) {
    return;
  }

  const deadline = Number(
    agreementData.blockchain_deadline || agreementData.deadline || 0,
  );

  if (!deadline) {
    return;
  }

  const now = Math.floor(Date.now() / 1000);

  // Agreement has not expired yet.
  if (now <= deadline) {
    return;
  }

  // Do NOT expire if the agreement is already Completed, Cancelled, or Expired
  const blockchainStatus = Number(agreementData.blockchain_status || 0);
  if (blockchainStatus === 2 || blockchainStatus === 3) {
    return;
  }

  // Already expired
  if (blockchainStatus === 4) {
    await syncExpiredAgreementToSupabase();
    return;
  }

  // Blockchain expiry
  if (typeof window.ethereum === "undefined") {
    console.warn(
      "MetaMask unavailable. Agreement is expired by deadline but blockchain expiry could not be processed.",
    );

    return;
  }

  try {
    const web3 = new Web3(window.ethereum);
    const contract = new web3.eth.Contract(CONTRACT_ABI, CONTRACT_ADDRESS);
    const accounts = await window.ethereum.request({
      method: "eth_requestAccounts",
    });

    if (!accounts || accounts.length === 0) {
      console.warn(
        "No wallet connected. Expiry transaction cannot be submitted.",
      );

      return;
    }

    const account = accounts[0];

    console.log("Agreement deadline passed. Attempting blockchain expiry...");

    // Check current blockchain state again.
    const chainAgreement = await contract.methods
      .getAgreementBasic(Number(agreementId))
      .call();
    const currentStatus = Number(chainAgreement.status);

    // Only the agreement owner can confirm expiry and receive the refund.
    // Carriers are informed through the disabled milestone controls instead.
    if (account.toLowerCase() !== chainAgreement.shipper.toLowerCase()) {
      return;
    }

    // Completed / Cancelled
    if (currentStatus === 2 || currentStatus === 3) {
      return;
    }

    // Already expired
    if (currentStatus === 4) {
      agreementData.blockchain_status = 4;

      await syncExpiredAgreementToSupabase();

      return;
    }

    // Confirm expiry
    const confirmed = confirm(
      "This agreement has passed its deadline.\n\n" +
        "You are the Shipper. Confirm the expiry transaction to refund the remaining escrow to your wallet and mark this agreement as Expired.\n\n" +
        "Continue?",
    );

    if (!confirmed) {
      return;
    }

    const refundedAmount = getBlockchainEth(
      chainAgreement.escrowRemaining,
      agreementData.escrow_remaining,
    );
    const stakeForfeited =
      currentStatus === 1
        ? getBlockchainEth(
            chainAgreement.escrowAmount,
            agreementData.escrow_amount,
          ) * 0.3
        : 0;

    // Execute blockchain expiry
    const tx = await contract.methods
      .expireAgreement(Number(agreementId))
      .send({
        from: account,
      });

    console.log("Agreement expired on blockchain:", tx.transactionHash);

    // Update Supabase
    await syncExpiredAgreementToSupabase(
      tx.transactionHash,
      account,
      refundedAmount,
      stakeForfeited,
    );

    alert(
      "Agreement expired successfully.\n\n" +
        `Remaining escrow refunded: ${refundedAmount.toFixed(3)} ETH\n` +
        `Carrier stake forfeited to you: ${stakeForfeited.toFixed(3)} ETH\n\n` +
        "The expiry and stake-forfeiture records are now in transaction history.",
    );

    // Reload page state
    await loadAgreement();
  } catch (error) {
    console.error("Agreement expiry failed:", error);

    if (error?.code === 4001) {
      alert("Expiry transaction was rejected in MetaMask.");

      return;
    }

    console.warn("Could not automatically expire agreement:", error);
  }
}

async function syncExpiredAgreementToSupabase(
  transactionHash = null,
  actor = null,
  refundedAmount = null,
  stakeForfeited = 0,
) {
  try {
    const remainingWei = agreementData?.blockchain_escrow_remaining;

    let remainingEth = Number(refundedAmount || 0);

    if (
      refundedAmount === null &&
      remainingWei !== undefined &&
      remainingWei !== null
    ) {
      remainingEth = getBlockchainEth(remainingWei, 0);
    } else {
      remainingEth = Number(agreementData.escrow_remaining || 0);
    }

    // Update agreement
    const { error } = await supabaseClient
      .from("agreements")
      .update({
        status: "Expired",
        expired_at: Math.floor(Date.now() / 1000),
        refunded_amount: remainingEth,
        escrow_remaining: 0,
        escrow_released: Number(agreementData.escrow_released || 0),
      })
      .eq("agreement_id", Number(agreementId));

    if (error) {
      console.error("Failed to update expired agreement in Supabase:", error);

      return;
    }

    // Save transaction
    if (transactionHash && actor) {
      await saveTransaction(transactionHash, "AgreementExpired", actor, {
        status: "Expired",
        escrow_refunded: remainingEth,
        description:
          "Agreement expired after the deadline. Remaining escrow was refunded to the Shipper.",
      });

      if (stakeForfeited > 0) {
        await saveTransaction(
          `${transactionHash}:carrier-stake-forfeited`,
          "CarrierStakeForfeited",
          actor,
          {
            amount: stakeForfeited,
            stake_amount: stakeForfeited,
            blockchain_transaction_hash: transactionHash,
            description: `${stakeForfeited.toFixed(3)} ETH carrier performance stake was forfeited to the Shipper after the deadline.`,
          },
        );
      }
    }

    // Update local state
    agreementData.status = "Expired";
    agreementData.expired_at = Math.floor(Date.now() / 1000);
    agreementData.escrow_remaining = 0;
    agreementData.refunded_amount = remainingEth;
    agreementData.blockchain_status = 4;
  } catch (error) {
    console.error("Expired agreement synchronization failed:", error);
  }
}

// LOAD MILESTONES
async function loadMilestones() {
  const { data, error } = await supabaseClient
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
                paid,
                completed_at,
                verified_at,
                paid_at
            `,
    )
    .eq("agreement_id", Number(agreementId))
    .order("milestone_index", {
      ascending: true,
    });

  if (error) {
    throw error;
  }

  milestoneData = data || [];

  const { data: rejectionTransactions } = await supabaseClient
    .from("transactions")
    .select("agreement_id, details")
    .eq("agreement_id", Number(agreementId))
    .eq("event_type", "MilestoneRejected")
    .order("created_at", { ascending: false });

  milestoneData.forEach((milestone) => {
    milestone.isRejected = false;
    milestone.rejectionReason = null;

    if (rejectionTransactions) {
      const match = rejectionTransactions.find(
        (tx) =>
          Number(tx.details?.milestone_index) ===
          Number(milestone.milestone_index),
      );
      if (match && !normalizeBool(milestone.completed)) {
        milestone.isRejected = true;
        milestone.rejectionReason = match.details.reason;
      }
    }
  });

  // Prefer blockchain milestone state
  if (typeof window.ethereum !== "undefined") {
    try {
      const web3 = new Web3(window.ethereum);
      const contract = new web3.eth.Contract(CONTRACT_ABI, CONTRACT_ADDRESS);
      const count = Number(
        await contract.methods.getMilestoneCount(Number(agreementId)).call(),
      );

      if (count === milestoneData.length) {
        for (let i = 0; i < count; i++) {
          const chain = await contract.methods
            .getMilestone(Number(agreementId), i)
            .call();
          milestoneData[i].completed = normalizeBool(chain.completed);
          milestoneData[i].verified = normalizeBool(chain.verified);
          milestoneData[i].paid = normalizeBool(chain.paid);
          milestoneData[i].completed_at = Number(chain.completedAt) || null;
          milestoneData[i].verified_at = Number(chain.verifiedAt) || null;
        }
      }
    } catch (error) {
      console.warn("Could not load blockchain milestones:", error);
    }
  }
}

// RENDER AGREEMENT
function renderAgreement() {
  const status = agreementData.status || getStatusFromBlockchain() || "Created";
  setText("agreement-reference", agreementData.reference_no || "-");
  setText("agreement-shipment", agreementData.shipment_details || "-");
  const statusElement = document.getElementById("agreement-status");
  if (statusElement) {
    statusElement.innerHTML = `
            <span class="status-dot"></span>
            ${escapeHtml(status)}
        `;
    statusElement.className = "status-badge " + getStatusClass(status);
  }

  const priority = agreementData.priority || "Normal";
  setText("agreement-priority", priority.toUpperCase());
  setText(
    "shipper-address",
    shortenAddress(
      agreementData.blockchain_shipper || agreementData.shipper_address,
    ),
  );

  setText("carrier-address", getCarrierAddress());
  // Escrow
  const normalizedStatus = String(status).toLowerCase();
  const isExpired = normalizedStatus === "expired";
  const isCancelled = normalizedStatus === "cancelled";
  const escrowEth =
    isExpired || isCancelled
      ? Number(agreementData.escrow_amount || 0)
      : getBlockchainEth(
          agreementData.blockchain_escrow,
          agreementData.escrow_amount,
        );

  setText("escrow-amount", `${escrowEth.toFixed(3)} ETH`);

  // Deadline
  const deadline = Number(
    agreementData.blockchain_deadline || agreementData.deadline,
  );
  setText("agreement-deadline", formatDateTime(deadline));
  const countdownItem = document
    .getElementById("expiry-countdown")
    ?.closest(".summary-item");
  if (countdownItem) {
    countdownItem.style.display = isCancelled ? "none" : "block";
  }

  if (deadline && !isCancelled) {
    updateCountdown(deadline);
  }

  detectNetwork();
  // Etherscan
  const explorer = document.getElementById("etherscan-link");

  if (explorer) {
    explorer.href = `https://etherscan.io/address/${CONTRACT_ADDRESS}`;
  }

  // Shipment details
  setText("detail-shipment", agreementData.shipment_details || "-");
  const payload = Number(agreementData.payload_value || 0);
  setText(
    "detail-payload-value",
    `$${payload.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`,
  );
  setText("detail-priority", priority);
  setText("detail-origin", agreementData.origin || "-");
  setText("detail-destination", agreementData.destination || "-");

  // Financial section visibility
  const financialSection = document.querySelector(".shipment-agreement-card");
  const role = String(localStorage.getItem("role") || "").toLowerCase();
  const isCarrier = role === "2" || role === "carrier";
  if (financialSection) {
    const subsections = financialSection.querySelectorAll(".detail-subsection");

    if (subsections.length >= 3) {
      subsections[2].style.display =
        isCancelled || (isCarrier && status === "Created") ? "none" : "block";
    }
  }

  setText("detail-escrow-amount", `${escrowEth.toFixed(3)} ETH`);

  const hasMilestoneData = milestoneData.length > 0;
  const paidMilestonePercentage = milestoneData.reduce(
    (total, milestone) =>
      normalizeBool(milestone.paid)
        ? total + Number(milestone.percentage || 0)
        : total,
    0,
  );
  const recordedRefund = Number(agreementData.refunded_amount || 0);
  const released = isExpired
    ? hasMilestoneData
      ? Math.min(escrowEth, (escrowEth * paidMilestonePercentage) / 100)
      : Math.max(0, escrowEth - recordedRefund)
    : Number(agreementData.escrow_released || 0);
  const remaining = isExpired
    ? Math.max(0, escrowEth - released)
    : getBlockchainEth(
        agreementData.blockchain_escrow_remaining,
        agreementData.escrow_remaining,
      );

  setText("detail-escrow-released", `${released.toFixed(3)} ETH`);

  setText("detail-escrow-remaining", `${remaining.toFixed(3)} ETH`);

  setText(
    "detail-escrow-released-label",
    isExpired ? "ESCROW RELEASED TO CARRIER" : "ESCROW RELEASED",
  );
  setText(
    "detail-escrow-remaining-label",
    isExpired ? "ESCROW RETURNED TO SHIPPER" : "ESCROW REMAINING",
  );
}

// GET STATUS FROM BLOCKCHAIN
function getStatusFromBlockchain() {
  const status = Number(agreementData?.blockchain_status);

  switch (status) {
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

    default:
      return null;
  }
}

// MILESTONES
function renderMilestones() {
  const container = document.getElementById("milestones-container");

  if (!container) {
    return;
  }

  container.innerHTML = "";

  if (!milestoneData || milestoneData.length === 0) {
    container.innerHTML = `
            <div class="milestone-empty">
                No milestones found.
            </div>
        `;

    updateOverallProgress();

    return;
  }

  const status = agreementData.status;

  let currentIndex = Number(agreementData.blockchain_current_milestone);

  if (!Number.isInteger(currentIndex) || currentIndex < 0) {
    currentIndex = findFirstUnpaidMilestone();
  }

  if (currentIndex >= milestoneData.length) {
    currentIndex = -1;
  }

  const role = String(localStorage.getItem("role") || "").toLowerCase();
  const isCarrier = role === "2" || role === "carrier";
  const isShipper = role === "1" || role === "shipper";
  milestoneData.forEach((milestone, index) => {
    const completed = normalizeBool(milestone.completed);
    const verified = normalizeBool(milestone.verified);
    const paid = normalizeBool(milestone.paid);
    const percentage = Number(milestone.percentage || 0);
    const checkpoint = milestone.checkpoint || `Milestone ${index + 1}`;
    const amount = calculateMilestoneAmount(percentage);

    let state = "pending";
    let stateText = "Pending";

    const isExpiredForDisplay =
      String(status).toLowerCase() === "expired" || isAgreementExpired();

    if (String(status).toLowerCase() === "cancelled") {
      state = "inactive";
      stateText = "Cancelled";
    } else if (isExpiredForDisplay) {
      state = "inactive";
      if (completed && verified && paid) {
        stateText = "Completed & Paid";
      } else if (completed && !verified) {
        stateText = "Awaiting Verification";
      } else {
        stateText = "Expired";
      }
    } else if (completed && verified && paid) {
      state = "completed";
      stateText = "Completed & Paid";
    } else if (milestone.isRejected) {
      state = "cancelled";
      stateText = "Rejected";
    } else if (completed && !verified) {
      state = "active";
      stateText = "Awaiting Verification";
    } else if (index === currentIndex) {
      state = "active";
      stateText = "Pending";
    }

    const verificationPendingTooLong =
      completed &&
      !verified &&
      isVerificationPendingOverFiveMinutes(milestone.completed_at);

    let action = "";

    // Priority check for rejections
    if (milestone.isRejected) {
      const rejectionMode = isShipper ? "review" : "submit";
      const rejectionLabel = isShipper
        ? "View Rejection Reason"
        : "View Rejection Reason & Re-submit";
      action = `
                    <button
                        type="button"
                        class="danger-action-btn"
                        style="margin-top: 12px; padding: 8px 14px; font-size: 12px; background: #ef4444;"
                        onclick="openMilestoneSubmission(${agreementId}, ${index}, '${rejectionMode}')"
                    >
                        <i class="fa-solid fa-triangle-exclamation"></i>
                        ${rejectionLabel}
                    </button>
                `;
    } else if (completed || verified) {
      action = `
                    <button
                        type="button"
                        class="view-btn"
                        style="margin-top: 12px; padding: 6px 12px; font-size: 12px;"
                        onclick="openMilestoneSubmission(${agreementId}, ${index}, 'review')"
                    >
                        <i class="fa-solid fa-eye"></i>
                        View Submission Details
                    </button>
                `;
    } else if (
      status === "In Progress" &&
      !isAgreementExpired() &&
      index === currentIndex
    ) {
      if (isCarrier && !completed && !verified && !paid) {
        action = `
                        <button
                            type="button"
                            class="primary-action-btn"
                            style="margin-top: 12px; padding: 8px 14px; font-size: 12px;"
                            onclick="openMilestoneSubmission(${agreementId}, ${index}, 'submit')"
                        >
                            <i class="fa-solid fa-upload"></i>
                            Submit Completion
                        </button>
                    `;
      } else if (isShipper && completed && !verified && !paid) {
        action = "";
      }
    } else if (
      status === "In Progress" &&
      isAgreementExpired() &&
      isCarrier &&
      index === currentIndex &&
      !completed &&
      !verified &&
      !paid
    ) {
      action = "";
    }

    const item = document.createElement("div");

    item.className = `milestone-item ${state}`;

    const numberContent =
      completed && verified && paid
        ? '<i class="fa-solid fa-check"></i>'
        : index + 1;

    item.innerHTML = `
                <div class="milestone-left">

                    <div class="milestone-number">
                        ${numberContent}
                    </div>

                    <div class="milestone-info">

                        <h3>
                            ${escapeHtml(checkpoint)}
                        </h3>

                        <div class="milestone-meta">

                            <span>
                                ${percentage}%
                            </span>

                            <span class="milestone-separator">
                                •
                            </span>

                            <span>
                                ${amount} ETH
                            </span>

                        </div>

                        ${
                          isExpiredForDisplay && !completed
                            ? `
                                    <small
                                        style="
                                            display:block;
                                            margin-top:6px;
                                            color:#ef4444;
                                        "
                                    >
                                        Agreement expired. This milestone can no longer be submitted or verified.
                                    </small>
                                `
                            : ""
                        }

                        ${
                          completed &&
                          !verified &&
                          String(status).toLowerCase() !== "cancelled"
                            ? `
                                    <small
                                        style="
                                            display:block;
                                            margin-top:6px;
                                            color:#f59e0b;
                                        "
                                    >
                                        Carrier submitted completion.
                                    </small>
                                `
                            : ""
                        }

                        ${
                          isShipper &&
                          verificationPendingTooLong &&
                          String(status).toLowerCase() !== "cancelled"
                            ? `
                                    <div style="margin-top:8px; padding:8px 12px; background:rgba(245, 158, 11, 0.1); border:1px solid rgba(245, 158, 11, 0.3); border-radius:6px; color:#fbbf24; font-size:12px;">
                                        <i class="fa-solid fa-triangle-exclamation"></i> Verification pending over 5 minutes. Please review and verify this milestone.
                                    </div>
                                `
                            : ""
                        }

                        ${
                          completed && verified && paid
                            ? `
                                    <small
                                        style="
                                            display:block;
                                            margin-top:6px;
                                            color:#10b981;
                                        "
                                    >
                                        ${amount} ETH released to Carrier.
                                    </small>
                                `
                            : ""
                        }

                        ${action}

                    </div>
                </div>

                <div class="milestone-status ${state}">

                    <span class="milestone-status-dot"></span>

                    <span>
                        ${stateText}
                    </span>

                </div>
            `;

    container.appendChild(item);
  });

  updateOverallProgress();
}

function isVerificationPendingOverFiveMinutes(completedAt) {
  if (!completedAt) return false;

  const numericTimestamp = Number(completedAt);
  const submittedAtMs =
    Number.isFinite(numericTimestamp) && numericTimestamp > 0
      ? numericTimestamp * 1000
      : new Date(completedAt).getTime();

  return (
    Number.isFinite(submittedAtMs) && Date.now() > submittedAtMs + 5 * 60 * 1000
  );
}

// CHECK EXPIRY
function isAgreementExpired() {
  const deadline = Number(
    agreementData?.blockchain_deadline || agreementData?.deadline || 0,
  );

  if (!deadline) {
    return false;
  }

  return Math.floor(Date.now() / 1000) > deadline;
}

// CURRENT MILESTONE
function getCurrentMilestoneIndex() {
  const blockchainIndex = Number(agreementData?.blockchain_current_milestone);

  if (
    Number.isInteger(blockchainIndex) &&
    blockchainIndex >= 0 &&
    blockchainIndex < milestoneData.length
  ) {
    return blockchainIndex;
  }
  return findFirstUnpaidMilestone();
}

function findFirstUnpaidMilestone() {
  for (let i = 0; i < milestoneData.length; i++) {
    const paid = normalizeBool(milestoneData[i].paid);

    if (!paid) {
      return i;
    }
  }

  return -1;
}

// CALCULATE PAYOUT DISPLAY
function calculateMilestoneAmount(percentage) {
  const terminalStatus = String(agreementData?.status || "").toLowerCase();
  const escrowEth = ["cancelled", "expired"].includes(terminalStatus)
    ? Number(agreementData?.escrow_amount || 0)
    : getBlockchainEth(
        agreementData?.blockchain_escrow,
        agreementData?.escrow_amount,
      );

  return ((escrowEth * Number(percentage)) / 100).toFixed(3);
}

// OVERALL PROGRESS
function updateOverallProgress() {
  const progressText = document.getElementById("overall-progress");
  const progressBar = document.getElementById("overall-progress-bar");
  let completedPercentage = 0;
  milestoneData.forEach((milestone) => {
    const completed = normalizeBool(milestone.completed);
    const verified = normalizeBool(milestone.verified);
    const paid = normalizeBool(milestone.paid);
    if (completed && verified && paid) {
      completedPercentage += Number(milestone.percentage || 0);
    }
  });

  if (progressText) {
    progressText.innerText = `${completedPercentage}%`;
  }

  if (progressBar) {
    progressBar.style.width = `${Math.min(completedPercentage, 100)}%`;
  }
}

// LIFECYCLE
function renderLifecycle() {
  const container = document.getElementById("lifecycle-timeline");

  if (!container) {
    return;
  }

  const status = agreementData.status || getStatusFromBlockchain() || "Created";
  // CANCELLED
  if (status === "Cancelled") {
    renderLifecycleStages(container, [
      {
        label: "Created",
        state: "completed",
      },

      {
        label: "Cancelled",
        state: "cancelled",
      },

      {
        label: "Refunded",
        state: "refunded",
      },
    ]);

    return;
  }

  // EXPIRED
  if (status === "Expired") {
    const carrier =
      agreementData.blockchain_carrier || agreementData.carrier_address;
    const wasAccepted = carrier && !isZeroAddress(carrier);

    const stages = [
      {
        label: "Created",
        state: "completed",
      },
    ];

    if (wasAccepted) {
      stages.push({
        label: "Accepted",
        state: "completed",
      });
    }

    stages.push(
      {
        label: "Expired",
        state: "expired",
      },
      {
        label: "Refunded",
        state: "refunded",
      },
    );

    renderLifecycleStages(container, stages);

    return;
  }

  // NORMAL
  const stages = [
    {
      label: "Created",
      state: "completed",
    },

    {
      label: "Accepted",
      state: "pending",
    },
  ];

  const carrier = getCarrierAddressRaw();

  if (carrier && !isZeroAddress(carrier)) {
    stages[1].state = "completed";
  } else if (status === "Created") {
    stages[1].state = "pending";
  }

  milestoneData.forEach((milestone) => {
    const completed = normalizeBool(milestone.completed);
    const verified = normalizeBool(milestone.verified);
    const paid = normalizeBool(milestone.paid);

    let stageState = "pending";
    if (completed && verified && paid) {
      stageState = "completed";
    } else if (milestone.isRejected) {
      stageState = "cancelled";
    } else if (completed) {
      stageState = "active";
    }

    stages.push({
      label: milestone.checkpoint,
      state: stageState,
    });
  });

  stages.push({
    label: "Completed",

    state: status === "Completed" ? "completed" : "pending",
  });

  renderLifecycleStages(container, stages);
}

// RENDER LIFECYCLE STAGES
function renderLifecycleStages(container, stages) {
  let html = "";

  stages.forEach((stage, index) => {
    let className = "pending";

    if (stage.state === "completed") {
      className = "completed";
    } else if (stage.state === "active") {
      className = "active";
    } else if (stage.state === "cancelled") {
      className = "cancelled";
    } else if (stage.state === "expired") {
      className = "expired";
    } else if (stage.state === "refunded") {
      className = "refunded";
    }

    let circle = index + 1;

    if (stage.state === "completed") {
      circle = '<i class="fa-solid fa-check"></i>';
    } else if (stage.state === "cancelled") {
      circle = '<i class="fa-solid fa-xmark"></i>';
    } else if (stage.state === "expired") {
      circle = '<i class="fa-solid fa-clock"></i>';
    } else if (stage.state === "refunded") {
      circle = '<i class="fa-solid fa-rotate-left"></i>';
    }

    html += `
                <div class="timeline-stage ${className}">

                    <div class="timeline-circle">
                        ${circle}
                    </div>

                    <span>
                        ${escapeHtml(stage.label)}
                    </span>

                </div>
            `;
  });

  container.innerHTML = html;
}

// ACTIONS
function setupActions() {
  const cancelButton = document.getElementById("cancel-btn");
  const role = String(localStorage.getItem("role") || "")
    .toLowerCase()
    .trim();
  const status = String(agreementData?.status || "")
    .toLowerCase()
    .trim();
  const isShipper = role === "1" || role === "shipper";
  const isCarrier = role === "2" || role === "carrier";
  const isActiveAgreement =
    status === "in progress" ||
    status === "active" ||
    Number(agreementData?.blockchain_status) === 1;

  // EXPIRED
  if (status === "expired") {
    if (cancelButton) {
      cancelButton.style.display = "none";
    }

    removeExtensionRequestButton();
    return;
  }

  // Handle Cancel / Accept Buttons
  if (cancelButton) {
    if (
      isShipper &&
      isAgreementExpired() &&
      (status === "created" || isActiveAgreement)
    ) {
      cancelButton.style.display = "inline-flex";
      cancelButton.disabled = false;
      cancelButton.className = "danger-action-btn";
      cancelButton.innerHTML = `<i class="fa-solid fa-clock"></i> Confirm Expiry & Refund`;
      cancelButton.onclick = processAgreementExpiry;
    } else if (isShipper && status === "created") {
      cancelButton.style.display = "inline-flex";
      cancelButton.disabled = false;
      cancelButton.className = "danger-action-btn";
      cancelButton.innerHTML = `<i class="fa-solid fa-xmark"></i> Cancel Agreement`;
      cancelButton.onclick = cancelAgreementAction;
    } else if (isCarrier && status === "created" && !isAgreementExpired()) {
      cancelButton.style.display = "inline-flex";
      cancelButton.disabled = false;
      cancelButton.className = "primary-action-btn";
      cancelButton.innerHTML = `<i class="fa-solid fa-check"></i> Accept Agreement`;
      cancelButton.onclick = acceptAgreementAction;
    } else {
      cancelButton.style.display = "none";
    }
  }

  // Deadline Extension Request Trigger (Within 1 Day / 86400 Seconds)
  const deadline = Number(
    agreementData.blockchain_deadline || agreementData.deadline,
  );
  const now = Math.floor(Date.now() / 1000);
  const timeRemaining = deadline - now;
  const ONE_DAY_IN_SECONDS = 86400;
  const pendingExtension =
    agreementData.extension_requested_deadline !== null &&
    agreementData.extension_requested_deadline !== undefined &&
    String(agreementData.extension_requested_deadline).trim() !== "";

  const canRequestExtension =
    isCarrier &&
    isActiveAgreement &&
    Number.isFinite(deadline) &&
    timeRemaining > 0 &&
    timeRemaining <= ONE_DAY_IN_SECONDS &&
    !pendingExtension;

  if (canRequestExtension) {
    showExtensionRequestButton();
  } else {
    removeExtensionRequestButton();
  }
}

// EXTENSION UI RENDERERS
function showExtensionRequestButton() {
  const actionContainer = document.querySelector(".agreement-actions");

  if (!actionContainer || document.getElementById("request-extension-btn")) {
    return;
  }

  const btn = document.createElement("button");
  btn.id = "request-extension-btn";
  btn.type = "button";
  btn.className = "primary-action-btn";
  btn.innerHTML = `<i class="fa-solid fa-hourglass-half"></i> Request Extension`;
  btn.onclick = openExtensionModal;

  actionContainer.appendChild(btn);
}

function removeExtensionRequestButton() {
  document.getElementById("request-extension-btn")?.remove();
}

function openExtensionModal() {
  let modal = document.getElementById("extension-request-modal");

  if (!modal) {
    modal = document.createElement("div");
    modal.id = "extension-request-modal";
    modal.className = "profile-modal";
    document.body.appendChild(modal);
  }

  const currentDeadline = Number(
    agreementData.blockchain_deadline || agreementData.deadline,
  );

  if (!Number.isFinite(currentDeadline)) {
    alert("The current agreement deadline is invalid.");
    return;
  }

  const toLocalDateTimeValue = (timestamp) => {
    const date = new Date(timestamp * 1000);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  };

  modal.innerHTML = `
        <div class="profile-modal-card" role="dialog" aria-modal="true" aria-labelledby="extension-modal-title">
            <h3 id="extension-modal-title"><i class="fa-solid fa-clock"></i> Request Deadline Extension</h3>
            <label>
                New Date & Time (up to 10 days after the current deadline)
                <input type="datetime-local" id="ext-date-input"
                    min="${toLocalDateTimeValue(currentDeadline)}"
                    max="${toLocalDateTimeValue(currentDeadline + 10 * 86400)}" required>
            </label>
            <label style="margin-top: 12px;">
                Reason for Extension
                <input type="text" id="ext-reason-input" placeholder="e.g. Customs delay, bad weather" maxlength="200">
            </label>
            <p id="ext-modal-message" class="profile-modal-note" role="alert"></p>
            <div class="profile-modal-actions">
                <button type="button" class="profile-cancel-btn" id="cancel-ext-btn">Cancel</button>
                <button type="button" class="profile-save-btn" id="submit-ext-btn">Submit Request</button>
            </div>
        </div>
    `;

  document.getElementById("cancel-ext-btn").onclick = () => {
    modal.hidden = true;
  };
  document.getElementById("submit-ext-btn").onclick =
    submitDeadlineExtensionRequest;

  modal.hidden = false;
}

async function submitDeadlineExtensionRequest() {
  const dateInput = document.getElementById("ext-date-input")?.value;
  const reasonInput =
    document.getElementById("ext-reason-input")?.value.trim() || "";
  const messageEl = document.getElementById("ext-modal-message");

  const role = String(localStorage.getItem("role") || "")
    .toLowerCase()
    .trim();
  const status = String(agreementData?.status || "")
    .toLowerCase()
    .trim();
  const isActiveAgreement =
    status === "in progress" ||
    status === "active" ||
    Number(agreementData?.blockchain_status) === 1;

  if (!dateInput) {
    if (messageEl)
      messageEl.innerText = "Please select a valid extension date and time.";
    return;
  }

  const selectedTimestamp = Math.floor(new Date(dateInput).getTime() / 1000);
  const currentDeadline = Number(
    agreementData.blockchain_deadline || agreementData.deadline,
  );
  const maxAllowedTimestamp = currentDeadline + 10 * 24 * 3600; // 10 days max
  const hasPendingExtension =
    agreementData.extension_requested_deadline !== null &&
    agreementData.extension_requested_deadline !== undefined &&
    String(agreementData.extension_requested_deadline).trim() !== "";

  if (
    (role !== "2" && role !== "carrier") ||
    !isActiveAgreement ||
    hasPendingExtension
  ) {
    if (messageEl)
      messageEl.innerText = "This extension request is no longer available.";
    return;
  }

  if (selectedTimestamp <= currentDeadline) {
    if (messageEl)
      messageEl.innerText =
        "The new deadline must be after the current deadline.";
    return;
  }

  if (selectedTimestamp > maxAllowedTimestamp) {
    if (messageEl)
      messageEl.innerText =
        "Extension cannot exceed 10 days beyond current deadline.";
    return;
  }

  try {
    if (messageEl) messageEl.innerText = "Submitting request...";

    const { data, error } = await supabaseClient
      .from("agreements")
      .update({
        extension_requested_deadline: selectedTimestamp,
        extension_request_reason: reasonInput,
      })
      .eq("agreement_id", Number(agreementId))
      .is("extension_requested_deadline", null)
      .select("agreement_id");

    if (error) throw error;

    if (!data || data.length === 0) {
      throw new Error(
        "An extension request already exists for this agreement.",
      );
    }

    await saveTransaction(
      "N/A-" + Date.now(),
      "DeadlineExtensionRequested",
      localStorage.getItem("wallet") || "",
      {
        requested_deadline: selectedTimestamp,
        reason: reasonInput,
        description: "Carrier requested deadline extension.",
      },
    );

    alert("Extension request submitted successfully to Shipper.");
    window.location.reload();
  } catch (err) {
    console.error("Extension request error:", err);
    if (messageEl) messageEl.innerText = "Failed: " + (err.message || err);
  }
}

// ACCEPT AGREEMENT
async function acceptAgreementAction() {
  if (isAgreementExpired()) {
    alert(
      "This agreement has passed its deadline and is awaiting the Shipper's expiry confirmation.",
    );
    return;
  }

  const currentWallet = (localStorage.getItem("wallet") || "").toLowerCase();
  const shipperAddress = (
    agreementData?.blockchain_shipper ||
    agreementData?.shipper_address ||
    ""
  ).toLowerCase();

  if (shipperAddress && currentWallet === shipperAddress) {
    alert(
      "Action Denied: Shippers cannot accept their own logistics agreements as carriers.",
    );
    return;
  }

  await sharedAcceptAgreement(agreementId, agreementData?.reference_no, () =>
    window.location.reload(),
  );
}

// CANCEL AGREEMENT
async function cancelAgreementAction() {
  const refund = Number(
    agreementData?.escrow_remaining || agreementData?.escrow_amount || 0,
  );

  await sharedCancelAgreement(
    agreementId,
    agreementData?.reference_no,
    refund,
    agreementData?.status,
    () => window.location.reload(),
  );
}

// Request extend agreement deadline
async function requestDeadlineExtension(id) {
  const newDate = prompt("Enter new deadline date (YYYY-MM-DD):");
  if (!newDate) return;
  const timestamp = Math.floor(new Date(newDate).getTime() / 1000);
  const reason = prompt("Enter reason for delay (optional):") || "";
  const wallet = localStorage.getItem("wallet");
  await sharedRequestExtension(id, timestamp, reason, wallet, () =>
    window.location.reload(),
  );
}

// SAVE TRANSACTION
async function saveTransaction(hash, eventType, actor, details) {
  const { error } = await supabaseClient.from("transactions").insert([
    {
      transaction_hash: hash,

      agreement_id: Number(agreementId),

      event_type: eventType,

      actor_address: actor.toLowerCase(),

      details: details,
    },
  ]);

  if (error) {
    console.warn("Transaction save failed:", error);
  }
}

// HELPERS
function findMilestoneActionButton(text) {
  return Array.from(
    document.querySelectorAll("#milestones-container button"),
  ).find((button) => button.innerText.includes(text));
}

function getCarrierAddressRaw() {
  return (
    agreementData.blockchain_carrier || agreementData.carrier_address || ""
  );
}

function getCarrierAddress() {
  const carrier = getCarrierAddressRaw();

  if (!carrier || isZeroAddress(carrier)) {
    return "Unassigned";
  }

  return shortenAddress(carrier);
}

function isZeroAddress(address) {
  return (
    String(address).toLowerCase() ===
    "0x0000000000000000000000000000000000000000"
  );
}

function normalizeBool(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

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

function setText(id, value) {
  const element = document.getElementById(id);

  if (element) {
    element.innerText = value;
  }
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

// STATUS CLASS
function getStatusClass(status) {
  switch (status) {
    case "Created":
      return "status-available";

    case "In Progress":
      return "status-active";

    case "Completed":
      return "status-completed";

    case "Refunded":
      return "status-refunded";

    case "Cancelled":
      return "status-cancelled";

    case "Expired":
      return "status-expired";

    default:
      return "status-active";
  }
}

function openMilestoneSubmission(agreementId, milestoneIndex, mode) {
  window.location.href = `milestoneSubmission.html?agreementId=${Number(agreementId)}&milestoneIndex=${Number(milestoneIndex)}&mode=${encodeURIComponent(mode)}&from=agreement-details`;
}

function formatDateTime(timestamp) {
  if (!timestamp) {
    return "-";
  }

  return new Date(Number(timestamp) * 1000).toLocaleString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// COUNTDOWN
function updateCountdown(deadline) {
  const element = document.getElementById("expiry-countdown");

  if (!element) {
    return;
  }

  function update() {
    const difference = Number(deadline) - Math.floor(Date.now() / 1000);

    if (difference <= 0) {
      element.innerText = "Expired";

      element.classList.add("expired");

      return;
    }

    const days = Math.floor(difference / 86400);

    const hours = Math.floor((difference % 86400) / 3600);

    const minutes = Math.floor((difference % 3600) / 60);

    element.innerText = `${days}d ${hours}h ${minutes}m`;
  }

  update();

  setInterval(update, 60000);
}

async function detectNetwork() {
  try {
    if (typeof window.ethereum === "undefined") {
      return;
    }

    const web3 = new Web3(window.ethereum);

    const chainId = Number(await web3.eth.getChainId());

    setText(
      "network-name",
      chainId === 1337 || chainId === 5777 ? "Ganache" : `Chain ${chainId}`,
    );
  } catch (error) {
    console.warn("Network detection failed:", error);
  }
}

// SHORTEN ADDRESS
function shortenAddress(address) {
  if (!address) {
    return "-";
  }

  if (address.length < 12) {
    return address;
  }

  return (
    address.substring(0, 6) + "..." + address.substring(address.length - 4)
  );
}

// ESCAPE HTML
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

// ERROR
function showError(message) {
  const loading = document.getElementById("details-loading");

  if (loading) {
    loading.style.display = "none";
  }

  const errorElement = document.getElementById("details-error");

  if (!errorElement) {
    return;
  }

  errorElement.style.display = "block";

  errorElement.innerHTML = `
        <i class="fa-solid fa-circle-exclamation"></i>
        ${escapeHtml(message)}

        <br><br>

        <a href="agreements.html">
            ← Back to Agreements
        </a>
    `;
}
