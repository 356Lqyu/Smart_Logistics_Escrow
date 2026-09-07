// =====================================================
// MILESTONE MANAGEMENT PAGE
// =====================================================

let milestoneWallet = null;
let milestoneRole = null;
let milestoneAgreements = [];
let expandedAgreements = new Set();

// =====================================================
// PAGE INITIALIZATION
// =====================================================

document.addEventListener("DOMContentLoaded", async () => {
  try {
    console.log("Milestone page initialization started...");

    await initialiseMilestonePage();
  } catch (error) {
    console.error("Milestone page initialization failed:", error);

    showPageError(error?.message || String(error));
  }
});

// =====================================================
// INITIALISE MILESTONE PAGE
// =====================================================

async function initialiseMilestonePage() {
  milestoneWallet = localStorage.getItem("wallet");

  if (!milestoneWallet) {
    throw new Error("Wallet information not found. Please reconnect MetaMask.");
  }

  milestoneRole = String(
    localStorage.getItem("userRole") || localStorage.getItem("role") || "",
  ).toLowerCase();

  if (milestoneRole === "1" || milestoneRole === "shipper") {
    milestoneRole = "shipper";
  } else if (milestoneRole === "2" || milestoneRole === "carrier") {
    milestoneRole = "carrier";
  } else {
    throw new Error("User role not found.");
  }

  await loadInProgressAgreements();
}

// =====================================================
// LOAD IN-PROGRESS AGREEMENTS
// =====================================================

async function loadInProgressAgreements() {
  const container = document.getElementById("milestones-page-container");

  if (!container) {
    return;
  }

  container.innerHTML = `

        <div class="details-loading">

            <i class="fa-solid fa-spinner fa-spin"></i>

            <p style="margin-top: 10px;">
                Loading in-progress agreements...
            </p>

        </div>

    `;

  try {
    const wallet = String(milestoneWallet).toLowerCase();

    let agreementQuery = supabaseClient
      .from("agreements")
      .select(
        `
                    agreement_id,
                    reference_no,
                    shipper_address,
                    carrier_address,
                    shipment_details,
                    payload_value,
                    origin,
                    destination,
                    deadline,
                    escrow_amount,
                    escrow_released,
                    escrow_remaining,
                    priority,
                    status,
                    current_milestone,
                    extension_requested_deadline,
                    extension_request_reason,
                    created_time,
                    accepted_at,
                    completed_at,
                    cancelled_at,
                    expired_at,
                    refunded_amount
                `,
      )
      .eq("status", "In Progress");

    if (milestoneRole === "carrier") {
      agreementQuery = agreementQuery.eq("carrier_address", wallet);
    } else if (milestoneRole === "shipper") {
      agreementQuery = agreementQuery.eq("shipper_address", wallet);
    }

    const { data: agreementRows, error: agreementError } =
      await agreementQuery.order("agreement_id", {
        ascending: false,
      });

    if (agreementError) {
      throw agreementError;
    }

    // A deadline makes milestone work unavailable immediately, even when
    // the shipper has not yet submitted the on-chain expiry transaction.
    const now = Math.floor(Date.now() / 1000);
    milestoneAgreements = (agreementRows || []).filter(
      (agreement) => Number(agreement.deadline || 0) > now,
    );

    if (milestoneAgreements.length === 0) {
      renderNoAgreements();

      return;
    }

    const agreementIds = milestoneAgreements.map((agreement) =>
      Number(agreement.agreement_id),
    );

    const { data: milestoneRows, error: milestoneError } = await supabaseClient
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
                    verified_at,
                    paid,
                    paid_at
                `,
      )
      .in("agreement_id", agreementIds)
      .order("milestone_index", {
        ascending: true,
      });

    // After loading milestoneRows, query latest rejections
    const { data: rejectionTransactions } = await supabaseClient
      .from("transactions")
      .select("agreement_id, details")
      .in("agreement_id", agreementIds)
      .eq("event_type", "MilestoneRejected")
      .order("created_at", { ascending: false });

    milestoneRows.forEach((milestone) => {
      milestone.isRejected = false;
      milestone.rejectionReason = null;

      if (rejectionTransactions) {
        const match = rejectionTransactions.find(
          (tx) =>
            Number(tx.agreement_id) === Number(milestone.agreement_id) &&
            Number(tx.details?.milestone_index) ===
              Number(milestone.milestone_index),
        );
        if (match && !normalizeBool(milestone.completed)) {
          milestone.isRejected = true;
          milestone.rejectionReason = match.details.reason;
        }
      }
    });

    if (milestoneError) {
      throw milestoneError;
    }

    if (typeof window.ethereum !== "undefined") {
      try {
        const web3 = new Web3(window.ethereum);
        const contract = new web3.eth.Contract(CONTRACT_ABI, CONTRACT_ADDRESS);

        for (let agreement of milestoneAgreements) {
          const agreementIdNum = Number(agreement.agreement_id);
          const chainAgreement = await contract.methods
            .getAgreementBasic(agreementIdNum)
            .call();

          agreement.blockchain_escrow = chainAgreement.escrowAmount;
          agreement.blockchain_escrow_remaining =
            chainAgreement.escrowRemaining;
          agreement.blockchain_shipper = chainAgreement.shipper;
          agreement.blockchain_carrier = chainAgreement.carrier;
          agreement.blockchain_status = Number(chainAgreement.status);
          agreement.blockchain_current_milestone = Number(
            chainAgreement.currentMilestone,
          );

          const count = Number(
            await contract.methods.getMilestoneCount(agreementIdNum).call(),
          );
          const agreementMilestones = milestoneRows.filter(
            (m) => Number(m.agreement_id) === agreementIdNum,
          );

          if (count === agreementMilestones.length) {
            for (let i = 0; i < count; i++) {
              const chain = await contract.methods
                .getMilestone(agreementIdNum, i)
                .call();
              const targetMilestone = agreementMilestones.find(
                (m) => Number(m.milestone_index) === i,
              );
              if (targetMilestone) {
                targetMilestone.completed = normalizeBool(chain.completed);
                targetMilestone.verified = normalizeBool(chain.verified);
                targetMilestone.paid = normalizeBool(chain.paid);
              }
            }
          }
        }
      } catch (chainErr) {
        console.warn(
          "Could not sync blockchain state for milestone page:",
          chainErr,
        );
      }
    }

    const milestoneMap = {};

    (milestoneRows || []).forEach((milestone) => {
      const agreementId = Number(milestone.agreement_id);

      if (!milestoneMap[agreementId]) {
        milestoneMap[agreementId] = [];
      }

      milestoneMap[agreementId].push(milestone);
    });

    milestoneAgreements.forEach((agreement) => {
      const agreementId = Number(agreement.agreement_id);

      agreement.milestones = milestoneMap[agreementId] || [];
    });

    renderAgreements();
  } catch (error) {
    console.error("Failed to load milestone items:", error);

    container.innerHTML = `

            <div class="details-error">

                Error loading milestones:
                ${escapeHtml(error?.message || String(error))}

            </div>

        `;
  }
}

// =====================================================
// RENDER AGREEMENTS
// =====================================================

function renderAgreements() {
  renderVerificationReminderBar();

  const container = document.getElementById("milestones-page-container");

  if (!container) {
    return;
  }

  container.innerHTML = "";

  milestoneAgreements.forEach((agreement) => {
    const agreementId = Number(agreement.agreement_id);

    const milestones = agreement.milestones || [];

    const isExpanded = expandedAgreements.has(agreementId);

    let completedPercentage = 0;

    milestones.forEach((milestone) => {
      const completed = normalizeBool(milestone.completed);
      const verified = normalizeBool(milestone.verified);
      const paid = normalizeBool(milestone.paid);

      if (completed && verified && paid) {
        completedPercentage += Number(milestone.percentage || 0);
      }
    });

    let activeIndex = Number(agreement.blockchain_current_milestone);

    if (
      !Number.isInteger(activeIndex) ||
      activeIndex < 0 ||
      activeIndex >= milestones.length
    ) {
      activeIndex = -1;
      for (let i = 0; i < milestones.length; i++) {
        const paid = normalizeBool(milestones[i].paid);
        if (!paid) {
          activeIndex = i;
          break;
        }
      }
    }

    const currentMilestone = milestones[activeIndex];
    const isCurrentCompleted = currentMilestone
      ? normalizeBool(currentMilestone.completed)
      : false;
    const isCurrentVerified = currentMilestone
      ? normalizeBool(currentMilestone.verified)
      : false;

    let extraBadgeHtml = "";

    if (
      milestoneRole === "shipper" &&
      isCurrentCompleted &&
      !isCurrentVerified
    ) {
      extraBadgeHtml = `
        <span class="status-badge" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3);">
            <span class="status-dot" style="background-color: #f59e0b;"></span>
            Awaiting Verification
        </span>
    `;
    } else if (milestoneRole === "carrier") {
      if (currentMilestone && currentMilestone.isRejected) {
        extraBadgeHtml = `
            <span class="status-badge" style="background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3);">
                <span class="status-dot" style="background-color: #ef4444;"></span>
                Milestone Submission Rejected
            </span>
        `;
      } else if (isCurrentCompleted && !isCurrentVerified) {
        extraBadgeHtml = `
            <span class="status-badge" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3);">
                <span class="status-dot" style="background-color: #f59e0b;"></span>
                Awaiting Verification
            </span>
        `;
      } else {
        extraBadgeHtml = `
            <span class="status-badge" style="background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3);">
                <span class="status-dot" style="background-color: #3b82f6;"></span>
                Pending Submission
            </span>
        `;
      }
    }

    // Deadline and Extension checks
    const deadline = Number(
      agreement.blockchain_deadline || agreement.deadline || 0,
    );
    const now = Math.floor(Date.now() / 1000);
    const timeRemaining = deadline - now;
    const ONE_DAY_IN_SECONDS = 86400;
    const pendingExtension =
      agreement.extension_requested_deadline !== null &&
      agreement.extension_requested_deadline !== undefined &&
      String(agreement.extension_requested_deadline).trim() !== "";

    const canRequestExtension =
      milestoneRole === "carrier" &&
      Number.isFinite(deadline) &&
      timeRemaining > 0 &&
      timeRemaining <= ONE_DAY_IN_SECONDS &&
      !pendingExtension;

    let extensionActionHtml = "";
    if (canRequestExtension) {
      extensionActionHtml = `
                    <button type="button" class="primary-action-btn" style="margin-top: 18px; padding: 8px 14px; font-size: 12px;" onclick="event.stopPropagation(); openMilestoneExtensionModal(${agreementId}, ${deadline});">
                        <i class="fa-solid fa-hourglass-half"></i> Request Extension
                    </button>
                `;
    }

    let shipperApprovalHtml = "";
    if (milestoneRole === "shipper" && pendingExtension) {
      shipperApprovalHtml = `
                    <div style="margin-top: 15px; padding: 12px; background: #fffbeb00; border: 1px solid #4d64fc; border-radius: 8px;" onclick="event.stopPropagation();">
                        <div style="font-weight: bold; color: #3b82f6; margin-bottom: 6px;">
                            <i class="fa-solid fa-clock-rotate-left"></i> Deadline Extension Requested
                        </div>
                        <p style="font-size: 13px; margin: 4px 0; color: #ffffff;"><strong>Requested Deadline&nbsp:</strong> ${formatDate(agreement.extension_requested_deadline)}</p>
                        <p style="font-size: 13px; margin: 4px 0; color: #eff1f4;"><strong>Reason&nbsp&nbsp&nbsp&nbsp&nbsp&nbsp&nbsp&nbsp&nbsp&nbsp&nbsp&nbsp&nbsp&nbsp&nbsp&nbsp&nbsp&nbsp&nbsp&nbsp&nbsp&nbsp&nbsp:</strong> ${escapeHtml(agreement.extension_request_reason || "No reason provided.")}</p>
                        <div style="margin-top: 15px; display: flex; gap: 8px;">
                            <button type="button" class="primary-action-btn" style="padding: 6px 12px; font-size: 12px; background: #059669;" onclick="approveMilestoneExtension(${agreementId}, ${agreement.extension_requested_deadline})">
                                Approve Extension
                            </button>
                            <button type="button" class="danger-action-btn" style="padding: 6px 12px; font-size: 12px; background: #dc2626;" onclick="rejectMilestoneExtension(${agreementId})">
                                Reject Extension
                            </button>
                        </div>
                    </div>
                `;
    }

    const card = document.createElement("div");
    card.className = "details-card";
    card.style.marginBottom = "20px";

    card.innerHTML = `
                <!-- AGREEMENT HEADER -->
                <div onclick="toggleAgreementCard(${agreementId})" style="display:flex; justify-content:space-between; align-items:center; cursor:pointer;">
                    <div>
                        <div style="display:flex; align-items:center; gap:12px; margin-bottom:6px; flex-wrap:wrap;">
                            <h3 style="margin:0; color:#4f91ff; font-family:monospace; font-size:17px; font-weight:700;">
                                ${escapeHtml(agreement.reference_no || "Agreement #" + agreementId)}
                            </h3>
                            <span class="status-badge status-active">
                                <span class="status-dot"></span>
                                In Progress
                            </span>
                            ${extraBadgeHtml}
                        </div>
                        <div style="color:#8d99ae; font-size:12px;">
                            <i class="fa-regular fa-calendar" style="margin-right: 4px; margin-bottom: 10px;"></i> Deadline: <strong style="color:#e2e8f0;">${formatDate(deadline)}</strong>
                        </div>
                        <div style="color:#9bb0cc; font-size:14px; margin-bottom: 4px;">
                            ${escapeHtml(agreement.shipment_details || "Shipment")}
                        </div>
                    </div>
                    <i class="fa-solid ${isExpanded ? "fa-chevron-up" : "fa-chevron-down"}" style="color:#6683aa; font-size:15px;"></i>
                </div>

                <!-- PROGRESS -->
                <div style="margin-top:12px;">
                    <div class="overall-progress-header">
                        <span>Overall Completion</span>
                        <strong>${completedPercentage}%</strong>
                    </div>
                    <div class="progress-track">
                        <div class="progress-fill" style="width:${Math.min(completedPercentage, 100)}%;"></div>
                    </div>
                </div>


                <!-- MILESTONES -->
                <div id="milestones-${agreementId}" style="display:${isExpanded ? "block" : "none"}; margin-top:20px;">
                    ${renderMilestoneList(agreement, activeIndex)}
                </div>

                ${extensionActionHtml}
                ${shipperApprovalHtml}

            `;

    container.appendChild(card);
  });
}

function checkReminderWindow(milestone) {
  if (!milestone.completed_at || milestone.verified) return false;
  const FIVE_MINUTES = 300; // 5 minutes in seconds
  const submittedTime = new Date(milestone.completed_at).getTime() / 1000;
  const now = Math.floor(Date.now() / 1000);

  return now > submittedTime + FIVE_MINUTES;
}

// =====================================================
// RENDER MILESTONE LIST
// =====================================================

function renderMilestoneList(agreement, activeIndex) {
  const milestones = agreement.milestones || [];

  if (milestones.length === 0) {
    return `

            <div class="milestone-empty">
                No milestones found.
            </div>

        `;
  }

  return `

        <div class="milestones-container">

            ${milestones
              .map((milestone, index) =>
                renderMilestone(agreement, milestone, index, activeIndex),
              )
              .join("")}

        </div>

    `;
}

// =====================================================
// VERIFICATION PENDING REMINDER BAR
// =====================================================

function renderVerificationReminderBar() {
  const bar = document.getElementById("verification-reminder-bar");
  const detail = document.getElementById("verification-bar-details");

  if (!bar || !detail || milestoneRole !== "shipper") {
    if (bar) bar.style.display = "none";
    return;
  }

  let targetMilestoneInfo = null;
  const FIVE_MINUTES = 300; // 5 minutes in seconds
  const now = Math.floor(Date.now() / 1000);

  for (const agreement of milestoneAgreements) {
    if (!agreement.milestones) continue;

    for (const milestone of agreement.milestones) {
      const completed = normalizeBool(milestone.completed);
      const verified = normalizeBool(milestone.verified);

      if (completed && !verified && milestone.completed_at) {
        const submittedTime = new Date(milestone.completed_at).getTime() / 1000;
        if (now > submittedTime + FIVE_MINUTES) {
          targetMilestoneInfo = {
            agreementId: agreement.agreement_id,
            reference: agreement.reference_no,
            checkpoint:
              milestone.checkpoint ||
              `Milestone ${(milestone.milestone_index || 0) + 1}`,
          };
          break;
        }
      }
    }
    if (targetMilestoneInfo) break;
  }

  if (!targetMilestoneInfo) {
    bar.style.display = "none";
    return;
  }

  detail.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 16px; width: 100%;">
        <div>
            Verification pending over 5 minutes. Please review and verify milestone <strong>"${escapeHtml(targetMilestoneInfo.checkpoint)}"</strong> for agreement #${escapeHtml(targetMilestoneInfo.reference)}.
        </div>
            <button type="button" class="primary-action-btn" style="display: inline-flex; white-space: nowrap; padding: 6px 12px; font-size: 12px; background: #059669;" onclick="jumpToAgreementCard(${targetMilestoneInfo.agreementId})">
                <i class="fa-solid fa-arrow-right"></i> Go & Review
            </button>
        </div>
    `;
  bar.style.display = "block";
}

// Function to expand card and scroll to it
function jumpToAgreementCard(agreementId) {
  expandedAgreements.add(Number(agreementId));
  renderAgreements();

  // Smooth scroll to the specific agreement card after rendering
  setTimeout(() => {
    const cardElement = document
      .getElementById(`milestones-${agreementId}`)
      ?.closest(".details-card");
    if (cardElement) {
      cardElement.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, 100);
}

// =====================================================
// RENDER SINGLE MILESTONE
// =====================================================

function renderMilestone(agreement, milestone, milestoneIndex, activeIndex) {
  const agreementId = Number(agreement.agreement_id);

  const completed = normalizeBool(milestone.completed);

  const verified = normalizeBool(milestone.verified);

  const paid = normalizeBool(milestone.paid);

  const percentage = Number(milestone.percentage || 0);

  const checkpoint = milestone.checkpoint || `Milestone ${milestoneIndex + 1}`;

  const deadline = Number(
    agreement.blockchain_deadline || agreement.deadline || 0,
  );
  const deadlinePassed =
    deadline > 0 && Math.floor(Date.now() / 1000) > deadline;

  const escrowEth = agreement.blockchain_escrow
    ? Number(
        Web3.utils.fromWei(agreement.blockchain_escrow.toString(), "ether"),
      )
    : Number(agreement?.escrow_amount || 0);

  const amount = ((escrowEth * percentage) / 100).toFixed(3);

  let state = "pending";
  let stateText = "Pending";

  if (completed && verified && paid) {
    state = "completed";
    stateText = "Completed & Paid";
  } else if (milestone.isRejected) {
    state = "cancelled";
    stateText = "Rejected";
  } else if (completed && !verified) {
    state = "active";
    stateText = "Awaiting Verification";
  } else if (milestoneIndex === activeIndex) {
    state = "active";
    stateText = "Pending";
  }

  let reminderHtml = "";
  if (
    milestoneRole === "shipper" &&
    completed &&
    !verified &&
    checkReminderWindow(milestone)
  ) {
    reminderHtml = `
            <div style="margin-top: 8px; padding: 8px 12px; background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 6px; color: #fbbf24; font-size: 12px;">
                <i class="fa-solid fa-triangle-exclamation"></i> Verification pending over 5 minutes. Please review and verify this milestone.
            </div>
        `;
  }

  let actionHtml = "";
  const isCurrentActive = milestoneIndex === activeIndex;

  if (milestone.isRejected) {
    const rejectionMode = milestoneRole === "shipper" ? "review" : "submit";
    const rejectionLabel =
      milestoneRole === "shipper"
        ? "View Rejection Reason"
        : "View Rejection Reason & Re-submit";
    actionHtml = `
            <button
                type="button"
                class="danger-action-btn"
                style="margin-top: 12px; padding: 8px 14px; font-size: 12px; background: #ef4444;"
                onclick="
                    event.stopPropagation();
                    openMilestoneSubmission(
                        ${agreementId},
                        ${milestoneIndex},
                        '${rejectionMode}'
                    );
                "
            >
                <i class="fa-solid fa-triangle-exclamation"></i>
                ${rejectionLabel}
            </button>
        `;
  } else if (completed || verified) {
    actionHtml = `
            <button
                type="button"
                class="view-btn"
                style="margin-top: 12px; padding: 6px 12px; font-size: 12px;"
                onclick="
                    event.stopPropagation();
                    openMilestoneSubmission(
                        ${agreementId},
                        ${milestoneIndex},
                        'review'
                    );
                "
            >
                <i class="fa-solid fa-eye"></i>
                View Submission Details
            </button>
        `;
  } else if (milestoneRole === "carrier" && !completed && isCurrentActive) {
    actionHtml = `
            <button
                type="button"
                class="primary-action-btn"
                style="margin-top: 12px; padding: 8px 14px; font-size: 12px;"
                onclick="
                    event.stopPropagation();
                    openMilestoneSubmission(
                        ${agreementId},
                        ${milestoneIndex},
                        'submit'
                    );
                "
            >
                <i class="fa-solid fa-upload"></i>
                Submit Completion
            </button>
        `;
  } else if (
    milestoneRole === "shipper" &&
    completed &&
    !verified &&
    isCurrentActive
  ) {
    actionHtml = `
            <button
                type="button"
                class="primary-action-btn"
                style="margin-top: 12px; padding: 8px 14px; font-size: 12px;"
                onclick="
                    event.stopPropagation();
                    openMilestoneSubmission(
                        ${agreementId},
                        ${milestoneIndex},
                        'review'
                    );
                "
            >
                <i class="fa-solid fa-file-circle-check"></i>
                Review Submission
            </button>
        `;
  }

  const numberContent =
    completed && verified && paid
      ? '<i class="fa-solid fa-check"></i>'
      : milestoneIndex + 1;

  return `

        <div class="milestone-item ${state}">

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
                      completed && !verified
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

                    ${reminderHtml}
                    ${actionHtml}

                </div>

            </div>

            <div class="milestone-status ${state}">

                <span class="milestone-status-dot"></span>

                <span>
                    ${stateText}
                </span>

            </div>

        </div>

    `;
}

// =====================================================
// TOGGLE AGREEMENT
// =====================================================

function toggleAgreementCard(agreementId) {
  const id = Number(agreementId);

  if (expandedAgreements.has(id)) {
    expandedAgreements.delete(id);
  } else {
    expandedAgreements.add(id);
  }

  renderAgreements();
}

// =====================================================
// SUBMIT MILESTONE
// =====================================================

function openMilestoneSubmission(agreementId, milestoneIndex, mode) {
  window.location.href = `milestoneSubmission.html?agreementId=${Number(agreementId)}&milestoneIndex=${Number(milestoneIndex)}&mode=${encodeURIComponent(mode)}`;
}

// =====================================================
// NO AGREEMENTS
// =====================================================

function renderNoAgreements() {
  const container = document.getElementById("milestones-page-container");

  if (!container) {
    return;
  }

  container.innerHTML = `

        <div class="details-card" style="text-align:center; padding:50px; color:#8fa7c7;">

            <i
                class="fa-solid fa-route"
                style="
                    font-size:40px;
                    margin-bottom:15px;
                    color:#3a506b;
                "
            ></i>


            <h3 style="color:#f2f6fc; margin-bottom: 8px;">
                No In-Progress Agreements
            </h3>


            <p style="color:#6683aa;">
                There are currently no active agreements
                with milestones to manage.
            </p>

        </div>

    `;
}

// =====================================================
// SHOW ERROR
// =====================================================

function showPageError(message) {
  const container = document.getElementById("milestones-page-container");

  if (!container) {
    return;
  }

  container.innerHTML = `

        <div class="details-error">

            Error loading milestones:
            ${escapeHtml(message)}

        </div>

    `;
}

function openMilestoneExtensionModal(agreementId, currentDeadline) {
  let modal = document.getElementById("extension-request-modal");

  if (!modal) {
    modal = document.createElement("div");
    modal.id = "extension-request-modal";
    modal.className = "profile-modal";
    document.body.appendChild(modal);
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
                New Date & Time (up to 10 days after current deadline)
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
  document.getElementById("submit-ext-btn").onclick = () =>
    submitMilestoneExtensionRequest(agreementId, currentDeadline);

  modal.hidden = false;
}

async function submitMilestoneExtensionRequest(agreementId, currentDeadline) {
  const dateInput = document.getElementById("ext-date-input")?.value;
  const reasonInput =
    document.getElementById("ext-reason-input")?.value.trim() || "";
  const selectedTimestamp = Math.floor(new Date(dateInput).getTime() / 1000);
  await sharedRequestExtension(
    agreementId,
    selectedTimestamp,
    reasonInput,
    milestoneWallet,
    () => window.location.reload(),
  );
}

async function approveMilestoneExtension(agreementId, requestedDeadline) {
  const agreement = milestoneAgreements.find(
    (a) => Number(a.agreement_id) === Number(agreementId),
  );
  await sharedApproveExtension(
    agreementId,
    agreement?.reference_no,
    requestedDeadline,
    () => window.location.reload(),
  );
}

async function rejectMilestoneExtension(agreementId) {
  const agreement = milestoneAgreements.find(
    (a) => Number(a.agreement_id) === Number(agreementId),
  );
  await sharedRejectExtension(agreementId, agreement?.reference_no, () =>
    window.location.reload(),
  );
}

function formatDate(timestamp) {
  if (!timestamp) return "-";
  return new Date(Number(timestamp) * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// =====================================================
// NORMALIZE BOOLEAN
// =====================================================

function normalizeBool(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

// =====================================================
// ESCAPE HTML
// =====================================================

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
