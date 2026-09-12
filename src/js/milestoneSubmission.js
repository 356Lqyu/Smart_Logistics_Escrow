let submissionAgreement;
let submissionMilestone;
let submissionEvidence;
let submissionAgreementId;
let submissionMilestoneIndex;
let submissionMode;
let submissionSource;
let rejectionReason = null;
let submissionProofHash = null;

document.addEventListener("DOMContentLoaded", initialiseSubmissionPage);

async function initialiseSubmissionPage() {
  try {
    const params = new URLSearchParams(window.location.search);
    submissionAgreementId = Number(params.get("agreementId"));
    submissionMilestoneIndex = Number(params.get("milestoneIndex"));
    submissionMode = params.get("mode") === "review" ? "review" : "submit";
    submissionSource =
      params.get("from") === "agreement-details"
        ? "agreement-details"
        : "milestones";
    configureBackLink();

    if (
      !Number.isInteger(submissionAgreementId) ||
      !Number.isInteger(submissionMilestoneIndex)
    ) {
      throw new Error("A valid agreement and milestone are required.");
    }

    const { data: agreement, error: agreementError } = await supabaseClient
      .from("agreements")
      .select("*")
      .eq("agreement_id", submissionAgreementId)
      .single();
    if (agreementError) throw agreementError;

    const { data: milestone, error: milestoneError } = await supabaseClient
      .from("milestones")
      .select("*")
      .eq("agreement_id", submissionAgreementId)
      .eq("milestone_index", submissionMilestoneIndex)
      .single();
    if (milestoneError) throw milestoneError;

    const { data: evidence, error: evidenceError } = await supabaseClient
      .from("milestone_evidence")
      .select("*")
      .eq("agreement_id", submissionAgreementId)
      .eq("milestone_index", submissionMilestoneIndex)
      .maybeSingle();
    if (evidenceError) {
      throw new Error("Milestone evidence storage is not configured.");
    }

    const { data: rejectionTransactions } = await TransactionRepository.query(
      (query) =>
        query
          .select("details, created_at")
          .eq("agreement_id", submissionAgreementId)
          .eq("event_type", "MilestoneRejected")
        .order("created_at", { ascending: false }),
    );

    const rejectionDetails = (rejectionTransactions || []).find(
      (transaction) =>
        Number(transaction.details?.milestone_index) ===
        submissionMilestoneIndex,
    )?.details;
    const isThisMilestoneRejected =
      Boolean(rejectionDetails) && !normalizeBool(milestone.completed);
    rejectionReason = isThisMilestoneRejected ? rejectionDetails.reason : null;

    submissionAgreement = agreement;
    submissionMilestone = milestone;
    submissionEvidence = evidence;
    await loadMilestoneProofHash();
    renderSubmissionPage();
  } catch (error) {
    document.getElementById("submission-page").innerHTML = `
            <div class="details-error">
                <i class="fa-solid fa-circle-exclamation"></i> ${escapeHtml(error.message || String(error))}
                <br><br>
                <a href="milestones.html" class="view-btn">Back to Milestones</a>
            </div>`;
  }
}

async function loadMilestoneProofHash() {
  try {
    const web3 = new Web3(window.ethereum);
    const contract = new web3.eth.Contract(CONTRACT_ABI, CONTRACT_ADDRESS);
    const hash = await contract.methods
      .getMilestoneProofHash(submissionAgreementId, submissionMilestoneIndex)
      .call();

    submissionProofHash = hash && !/^0x0+$/.test(hash) ? hash : null;
  } catch (error) {
    console.warn("Could not read milestone proof hash:", error);
    submissionProofHash = null;
  }
}

function configureBackLink() {
  const backLink = document.getElementById("submission-back-link");
  const backLabel = document.getElementById("submission-back-label");
  if (!backLink || !backLabel) return;

  if (submissionSource === "agreement-details") {
    backLink.href = `agreementDetails.html?id=${encodeURIComponent(submissionAgreementId)}`;
    backLabel.textContent = "Back to Agreement Details";
  }
}

function normalizeBool(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function renderSubmissionPage() {
  const role = String(localStorage.getItem("role") || "").toLowerCase();
  const isCarrier = role === "carrier" || role === "2";
  const isShipper = role === "shipper" || role === "1";
  const checkpoint =
    submissionMilestone.checkpoint ||
    `Milestone ${submissionMilestoneIndex + 1}`;

  const proofHtml = submissionEvidence?.proof_url
    ? `<img src="${escapeAttribute(submissionEvidence.proof_url)}" alt="Carrier submission proof" style="display:block; max-width:100%; max-height:480px; border-radius:10px; border:1px solid rgba(148,163,184,0.15);">`
    : '<span style="color:#64748b; font-style:italic;">No submission photo provided.</span>';

  const submittedAtFormatted = submissionMilestone.completed_at
    ? new Date(submissionMilestone.completed_at).toLocaleString()
    : "—";
  const verifiedAtFormatted = submissionMilestone.verified_at
    ? new Date(submissionMilestone.verified_at).toLocaleString()
    : "Not verified yet";
  const rejectionReasonHtml = rejectionReason
    ? `
        <div style="background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.3); padding: 18px; border-radius: 14px; margin-bottom: 24px;">
            <h4 style="color: #f87171; margin-bottom: 8px; font-size: 15px;"><i class="fa-solid fa-circle-exclamation"></i> Milestone Rejection Reason</h4>
            <p style="color: #cbd5e1; font-size: 13px; margin: 0; white-space: pre-wrap; line-height: 1.6;">${escapeHtml(rejectionReason)}</p>
        </div>
    `
    : "";

  let workflowHtml = "";
  if (submissionMode === "submit" && !submissionMilestone.completed) {
    const canSubmit = isCarrier && submissionAgreement.status === "In Progress";

    workflowHtml = canSubmit
      ? `
            ${rejectionReasonHtml}
            <form id="evidence-form">
                <div class="detail-subsection" style="border-top:none; padding-top:0;">
                    <div class="detail-subsection-header">
                        <div class="detail-subsection-title">
                            <span class="subsection-icon"><i class="fa-solid fa-pen-to-square"></i></span>
                            <div>
                                <span class="subsection-kicker">COMPLETION DATA</span>
                                <h3>Progress Notes & Details</h3>
                            </div>
                        </div>
                    </div>
                    <div class="shipment-description-box" style="margin-bottom: 20px;">
                        <textarea id="progress-notes" required rows="5" class="ca-inline-1e1541ba" placeholder="Describe what was completed and any relevant delivery information..."></textarea>
                    </div>

                    <div class="detail-subsection-header">
                        <div class="detail-subsection-title">
                            <span class="subsection-icon"><i class="fa-solid fa-image"></i></span>
                            <div>
                                <span class="subsection-kicker">EVIDENCE</span>
                                <h3>Upload Completion Photo</h3>
                            </div>
                        </div>
                    </div>
                    <div class="shipment-description-box" style="margin-bottom: 24px;">
                        <input id="proof-file" class="proof-file-input" type="file" accept="image/*">
                        <span id="proof-file-name" class="proof-file-name">No photo selected</span>
                        <label for="proof-file" class="proof-upload-icon" title="Upload completion photo" aria-label="Upload completion photo">
                            <i class="fa-solid fa-upload" style="font-size: 12px;" aria-hidden="true"></i>
                        </label>
                    </div>

                    <button id="submit-evidence-btn" class="primary-action-btn" type="submit" disabled><i class="fa-solid fa-upload"></i> Submit Evidence & Completion</button>
                </div>
            </form>`
      : `<p style="color:#fbbf24; margin-top:15px;">Only the assigned Carrier can submit evidence for the active pending milestone.</p>`;
  } else {
    const canVerify =
      isShipper &&
      submissionMilestone.completed &&
      !submissionMilestone.verified &&
      submissionEvidence;
    workflowHtml = `
        <div>
            ${rejectionReasonHtml}
            <!-- Agreement Info Grid (Matches Details Page Grid Style) -->
            <div class="agreement-info-grid" style="grid-template-columns: repeat(2, 1fr); margin-bottom: 24px;">
                <div class="info-item">
                    <span>SUBMISSION DATE & TIME</span>
                    <strong style="font-family: monospace; color: #38bdf8;">${escapeHtml(submittedAtFormatted)}</strong>
                </div>
                <div class="info-item">
                    <span>VERIFICATION DATE & TIME</span>
                    <strong style="font-family: monospace; color: #34d399;">${escapeHtml(verifiedAtFormatted)}</strong>
                </div>
            </div>

            <div class="detail-subsection" style="border-top:none; padding-top:0;">
                <div class="detail-subsection-header">
                    <div class="detail-subsection-title">
                        <span class="subsection-icon"><i class="fa-solid fa-note-sticky"></i></span>
                        <div>
                            <span class="subsection-kicker">SUBMISSION</span>
                            <h3>Carrier Submission Notes</h3>
                        </div>
                    </div>
                </div>
                <div class="shipment-description-box" style="margin-bottom: 24px;">
                    <div class="shipment-description">${escapeHtml(submissionEvidence?.progress_notes || "No submission details found.")}</div>
                </div>

                <div class="detail-subsection-header">
                    <div class="detail-subsection-title">
                        <span class="subsection-icon"><i class="fa-solid fa-camera"></i></span>
                        <div>
                            <span class="subsection-kicker">PROOF</span>
                            <h3>Uploaded Proof Evidence</h3>
                        </div>
                    </div>
                </div>
                <div class="shipment-description-box" style="margin-bottom: 24px;">
                    ${proofHtml}
                </div>
                ${
                  submissionProofHash
                    ? `
                    <p style="color:#8d99ae; font-size:13px; word-break:break-all; margin:-10px 0 24px;">
                        On-chain SHA-256: <span style="font-family:monospace; color:#38bdf8;">${escapeHtml(submissionProofHash)}</span>
                    </p>
                `
                    : ""
                }
                ${
                  submissionProofHash && submissionEvidence?.proof_url
                    ? `
                    <div style="margin:-10px 0 24px;">
                        <button id="check-proof-integrity-btn" class="view-btn" type="button">
                            <i class="fa-solid fa-shield-halved"></i> Check File Integrity
                        </button>
                        <p id="proof-integrity-result" style="display:none; margin:10px 0 0; font-size:13px;"></p>
                    </div>
                `
                    : ""
                }

                <div style="display:flex; gap:12px; align-items: center;">
                    ${
                      canVerify
                        ? `
                        <button id="verify-evidence-btn" class="primary-action-btn" type="button"><i class="fa-solid fa-check-double"></i> Verify & Release Payment</button>
                        <button id="reject-evidence-btn" class="danger-action-btn" type="button"><i class="fa-solid fa-xmark"></i> Reject Milestone</button>
                    `
                        : isCarrier
                          ? '<p style="color:#8d99ae; font-style:italic;">Viewing submitted milestone details and proof.</p>'
                          : ""
                    }
                </div>

                <!-- Rejection details (initially hidden) -->
                <div id="rejection-container" class="detail-subsection" style="display:none; margin-top:24px; padding:20px; border:1px solid rgba(239, 68, 68, 0.3); border-radius:10px; background:rgba(127, 29, 29, 0.08);">
                    <div class="detail-subsection-header">
                        <div class="detail-subsection-title">
                            <span class="subsection-icon" style="color:#f87171;"><i class="fa-solid fa-circle-exclamation"></i></span>
                            <div>
                                <span class="subsection-kicker" style="color:#f87171;">REJECTION DETAILS</span>
                                <h3>Reason for Rejection</h3>
                            </div>
                        </div>
                    </div>
                    <div class="shipment-description-box" style="margin-bottom:14px;">
                        <label class="detail-label" for="rejection-reason">REJECTION REASON</label>
                        <textarea id="rejection-reason" class="ca-inline-1e1541ba" rows="3" placeholder="Enter the reason why this milestone submission is being rejected..." style="width:100%; resize:vertical; margin:0;"></textarea>
                    </div>
                    <div style="display:flex; gap:10px; flex-wrap:wrap;">
                        <button id="confirm-reject-btn" class="danger-action-btn" type="button" disabled><i class="fa-solid fa-paper-plane"></i> Confirm Rejection</button>
                        <button id="cancel-reject-btn" class="view-btn" type="button">Cancel</button>
                    </div>
                </div>
            </div>
        </div>`;
  }

  document.getElementById("submission-page").innerHTML = `
        <section class="agreement-summary-card" style="margin-bottom: 20px;">
            <div class="agreement-summary-header">
                <div>
                    <div class="agreement-title-row">
                        <h2>${escapeHtml(checkpoint)}</h2>
                        <span class="status-badge status-active"><span class="status-dot"></span> Milestone ${submissionMilestoneIndex + 1}</span>
                        <span class="priority-badge priority-express">${submissionMilestone.percentage}% PAYOUT</span>
                    </div>
                    <p class="agreement-shipment">Agreement reference: <strong>${escapeHtml(submissionAgreement.reference_no)}</strong></p>
                </div>
            </div>
        </section>

        <section class="details-card shipment-agreement-card">
            ${workflowHtml}
        </section>`;

  document
    .getElementById("evidence-form")
    ?.addEventListener("submit", submitEvidenceAndCompletion);
  const updateEvidenceSubmitState = () => {
    const notes = document.getElementById("progress-notes")?.value.trim();
    const file = document.getElementById("proof-file")?.files?.[0];
    const submitButton = document.getElementById("submit-evidence-btn");
    if (submitButton) submitButton.disabled = !notes || !file;
  };
  document
    .getElementById("progress-notes")
    ?.addEventListener("input", updateEvidenceSubmitState);
  document.getElementById("proof-file")?.addEventListener("change", (event) => {
    const fileName = document.getElementById("proof-file-name");
    if (fileName) {
      fileName.textContent =
        event.target.files?.[0]?.name || "No photo selected";
    }
    updateEvidenceSubmitState();
  });
  document
    .getElementById("verify-evidence-btn")
    ?.addEventListener("click", verifyEvidenceAndRelease);
  document
    .getElementById("check-proof-integrity-btn")
    ?.addEventListener("click", checkProofIntegrity);
  document
    .getElementById("reject-evidence-btn")
    ?.addEventListener("click", () => {
      const rejContainer = document.getElementById("rejection-container");
      if (rejContainer) {
        rejContainer.style.display = "block";
        document.getElementById("rejection-reason")?.focus();
      }
    });
  document
    .getElementById("cancel-reject-btn")
    ?.addEventListener("click", () => {
      const rejContainer = document.getElementById("rejection-container");
      const reasonInput = document.getElementById("rejection-reason");
      const confirmButton = document.getElementById("confirm-reject-btn");
      if (reasonInput) reasonInput.value = "";
      if (confirmButton) confirmButton.disabled = true;
      if (rejContainer) rejContainer.style.display = "none";
    });
  document
    .getElementById("rejection-reason")
    ?.addEventListener("input", (event) => {
      const confirmButton = document.getElementById("confirm-reject-btn");
      if (confirmButton) confirmButton.disabled = !event.target.value.trim();
    });
  document
    .getElementById("confirm-reject-btn")
    ?.addEventListener("click", rejectEvidenceAndReset);
}

function setProofIntegrityResult(message, color) {
  const result = document.getElementById("proof-integrity-result");
  if (!result) return;

  result.style.display = "block";
  result.style.color = color;
  result.textContent = message;
}

async function calculateSha256Hex(arrayBuffer) {
  const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
  return (
    "0x" +
    Array.from(new Uint8Array(hashBuffer))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
  );
}

async function verifyProofIntegrity() {
  if (!submissionProofHash) {
    throw new Error("No on-chain hash exists for this milestone proof.");
  }
  if (!submissionEvidence?.proof_url) {
    throw new Error("The off-chain milestone proof file is unavailable.");
  }

  const response = await fetch(submissionEvidence.proof_url, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(
      `Could not download the proof file (HTTP ${response.status}).`,
    );
  }

  const actualHash = await calculateSha256Hex(await response.arrayBuffer());
  return actualHash.toLowerCase() === submissionProofHash.toLowerCase();
}

async function checkProofIntegrity() {
  const button = document.getElementById("check-proof-integrity-btn");
  if (button) {
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Checking…';
  }

  try {
    const matches = await verifyProofIntegrity();
    if (matches) {
      setProofIntegrityResult(
        "Verified: this file exactly matches the SHA-256 hash recorded on-chain.",
        "#34d399",
      );
    } else {
      setProofIntegrityResult(
        "Warning: this file does not match the on-chain SHA-256 hash and may have been changed.",
        "#f87171",
      );
    }
  } catch (error) {
    setProofIntegrityResult(
      `Could not check file integrity: ${error.message || String(error)}`,
      "#fbbf24",
    );
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML =
        '<i class="fa-solid fa-shield-halved"></i> Check File Integrity';
    }
  }
}

async function submitEvidenceAndCompletion(event) {
  event.preventDefault();
  const notes = document.getElementById("progress-notes").value.trim();
  const file = document.getElementById("proof-file").files[0];
  if (!notes || !file) {
    alert("Enter progress notes and upload a completion photo.");
    return;
  }
  if (!file.type.startsWith("image/")) {
    alert("Only image files can be uploaded as milestone proof.");
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    alert("Proof files must be 10 MB or smaller.");
    return;
  }

  const proofHash = await calculateSha256Hex(await file.arrayBuffer());

  const button = document.getElementById("submit-evidence-btn") || event.submitter;
  button.disabled = true;
  button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Submitting…';
  try {
    const account = await getWalletAccount();
    if (
      account.toLowerCase() !==
      String(submissionAgreement.carrier_address || "").toLowerCase()
    ) {
      throw new Error("Only the assigned Carrier can submit this evidence.");
    }
    const path = `${submissionAgreementId}/${submissionMilestoneIndex}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const { error: uploadError } = await supabaseClient.storage
      .from("milestone-evidence")
      .upload(path, file, { upsert: false });
    if (uploadError)
      throw new Error(`Photo upload failed: ${uploadError.message}`);
    const proofUrl = supabaseClient.storage
      .from("milestone-evidence")
      .getPublicUrl(path).data.publicUrl;
    const proofFileName = file.name;

    const web3 = new Web3(window.ethereum);
    const contract = new web3.eth.Contract(CONTRACT_ABI, CONTRACT_ADDRESS);

    let tx;
    try {
      tx = await contract.methods
        .submitMilestoneCompletion(submissionAgreementId, proofHash)
        .send({ from: account });
    } catch (sendError) {
      // Nothing on-chain happened -- safe to let the user just try again.
      if (sendError?.code === 4001) {
        alert(
          "Transaction was rejected in MetaMask. The page will refresh so you can try again.",
        );
        window.location.reload();
        return;
      }
      throw new Error(sendError.message || String(sendError));
    }

    // The blockchain submission is now confirmed and cannot be undone or
    // resubmitted (the contract rejects a second submitMilestoneCompletion
    // call for the same milestone). From here on, any failure must be
    // reported as a database sync issue, NOT as "submission failed" --
    // re-enabling the Submit button and inviting a retry would make the
    // next attempt revert on-chain with "Milestone already submitted".
    try {
      const { error: evidenceError } = await supabaseClient
        .from("milestone_evidence")
        .upsert(
          {
            agreement_id: submissionAgreementId,
            milestone_index: submissionMilestoneIndex,
            progress_notes: notes,
            proof_url: proofUrl || null,
            proof_file_name: proofFileName,
            submitted_by: account.toLowerCase(),
            transaction_hash: tx.transactionHash,
          },
          { onConflict: "agreement_id,milestone_index" },
        );
      if (evidenceError) throw evidenceError;

      await supabaseClient
        .from("milestones")
        .update({ completed: true, completed_at: new Date().toISOString() })
        .eq("agreement_id", submissionAgreementId)
        .eq("milestone_index", submissionMilestoneIndex);
      await TransactionRepository.record({
        transaction_hash: tx.transactionHash,
        agreement_id: submissionAgreementId,
        event_type: "MilestoneSubmitted",
        actor_address: account.toLowerCase(),
        details: {
          milestone_index: submissionMilestoneIndex,
          proof_hash: proofHash,
          description:
            "Carrier submitted milestone completion; proof SHA-256 recorded on-chain.",
        },
      });
    } catch (syncError) {
      console.error(
        "Milestone confirmed on-chain but Supabase sync failed:",
        syncError,
        "transaction hash:",
        tx.transactionHash,
      );
      alert(
        "Your milestone completion was confirmed on the blockchain " +
          `(transaction ${tx.transactionHash}), but saving the evidence ` +
          "details to the database failed: " +
          (syncError?.message || String(syncError)) +
          "\n\nDo NOT click Submit again -- the blockchain already has " +
          "your submission and resubmitting will fail. Refresh this page " +
          "instead; if the evidence still doesn't appear, contact support " +
          "with the transaction hash above.",
      );
      window.location.reload();
      return;
    }

    alert(
      "Evidence and milestone completion submitted. The Shipper can now review it.",
    );
    window.location.href = "milestones.html";
  } catch (error) {
    alert(`Milestone submission failed:\n\n${error.message || String(error)}`);
    button.disabled = false;
    button.innerHTML =
      '<i class="fa-solid fa-upload"></i> Submit Evidence & Completion';
  }
}

async function verifyEvidenceAndRelease() {
  try {
    const account = await getWalletAccount();
    if (
      account.toLowerCase() !==
      String(submissionAgreement.shipper_address || "").toLowerCase()
    )
      throw new Error("Only the Shipper can verify this milestone.");
    const proofIsUnchanged = await verifyProofIntegrity();
    if (!proofIsUnchanged) {
      throw new Error(
        "The proof file does not match its on-chain SHA-256 hash. Reject the milestone or investigate before releasing payment.",
      );
    }
    setProofIntegrityResult(
      "Verified: this file exactly matches the SHA-256 hash recorded on-chain.",
      "#34d399",
    );
    if (
      !confirm(
        "Verify this evidence and release the milestone payment to the Carrier?",
      )
    )
      return;

    const web3 = new Web3(window.ethereum);
    const contract = new web3.eth.Contract(CONTRACT_ABI, CONTRACT_ADDRESS);

    let tx;
    try {
      tx = await contract.methods
        .verifyMilestone(submissionAgreementId)
        .send({ from: account });
    } catch (sendError) {
      // Nothing on-chain happened -- safe to let the user just try again.
      if (sendError?.code === 4001) {
        alert(
          "Transaction was rejected in MetaMask. The page will refresh so you can try again.",
        );
        window.location.reload();
        return;
      }
      throw new Error(sendError.message || String(sendError));
    }

    // Payment has already been released on-chain and cannot be undone or
    // repeated (the contract rejects verifying an already-verified/paid
    // milestone). Any failure from here on is a database sync issue, not
    // a failed verification -- it must never be reported as if the
    // verification itself failed.
    try {
      const chainAgreement = await contract.methods
        .getAgreementBasic(submissionAgreementId)
        .call();
      const escrowTotal = Number(submissionAgreement.escrow_amount || 0);
      const payout =
        (escrowTotal * Number(submissionMilestone.percentage)) / 100;
      const now = new Date().toISOString();

      await supabaseClient
        .from("milestones")
        .update({
          completed: true,
          verified: true,
          paid: true,
          verified_at: now,
          paid_at: now,
        })
        .eq("agreement_id", submissionAgreementId)
        .eq("milestone_index", submissionMilestoneIndex);
      await supabaseClient
        .from("agreements")
        .update({
          escrow_released:
            Number(submissionAgreement.escrow_released || 0) + payout,
          escrow_remaining: Number(
            Web3.utils.fromWei(String(chainAgreement.escrowRemaining), "ether"),
          ),
          current_milestone: Number(chainAgreement.currentMilestone),
          status:
            Number(chainAgreement.status) === 2 ? "Completed" : "In Progress",
          completed_at:
            Number(chainAgreement.status) === 2
              ? Math.floor(Date.now() / 1000)
              : null,
        })
        .eq("agreement_id", submissionAgreementId);
      const transactionRecords = [
        {
          transaction_hash: tx.transactionHash,
          agreement_id: submissionAgreementId,
          event_type: "MilestoneVerified",
          actor_address: account.toLowerCase(),
          details: {
            milestone_index: submissionMilestoneIndex,
            amount: payout,
            description: `${payout.toFixed(3)} ETH released to Carrier.`,
          },
        },
      ];

      // Final verification returns the carrier's separately locked 30% stake.
      // Record it independently so it is never presented as milestone payroll.
      if (Number(chainAgreement.status) === 2) {
        const stakeReturned = escrowTotal * 0.3;
        transactionRecords.push({
          transaction_hash: `${tx.transactionHash}:carrier-stake-returned`,
          agreement_id: submissionAgreementId,
          event_type: "CarrierStakeReturned",
          actor_address: account.toLowerCase(),
          details: {
            amount: stakeReturned,
            stake_amount: stakeReturned,
            blockchain_transaction_hash: tx.transactionHash,
            description: `${stakeReturned.toFixed(3)} ETH carrier performance stake returned after successful completion.`,
          },
        });
      }
      await TransactionRepository.record(transactionRecords);
    } catch (syncError) {
      console.error(
        "Milestone verified/paid on-chain but Supabase sync failed:",
        syncError,
        "transaction hash:",
        tx.transactionHash,
      );
      alert(
        "Payment was released on the blockchain " +
          `(transaction ${tx.transactionHash}), but saving the update to ` +
          "the database failed: " +
          (syncError?.message || String(syncError)) +
          "\n\nDo NOT click Verify again -- the payment has already been " +
          "sent and re-verifying will fail. Refresh this page instead; if " +
          "the status still looks wrong, contact support with the " +
          "transaction hash above.",
      );
      window.location.reload();
      return;
    }

    alert("Evidence verified and payment released.");
    window.location.href = "milestones.html";
  } catch (error) {
    alert(`Milestone verification failed:\n\n${error.message || String(error)}`);
  }
}

async function rejectEvidenceAndReset() {
  try {
    const account = await getWalletAccount();
    if (
      account.toLowerCase() !==
      String(submissionAgreement.shipper_address || "").toLowerCase()
    ) {
      throw new Error("Only the Shipper can reject this milestone.");
    }

    const reasonInput = document.getElementById("rejection-reason");
    const reason = reasonInput ? reasonInput.value.trim() : "";
    if (!reason) {
      alert("A rejection reason is required.");
      return;
    }

    const web3 = new Web3(window.ethereum);
    const contract = new web3.eth.Contract(CONTRACT_ABI, CONTRACT_ADDRESS);

    let tx;
    try {
      tx = await contract.methods
        .rejectMilestone(submissionAgreementId, reason)
        .send({ from: account });
    } catch (sendError) {
      // Nothing on-chain happened -- safe to let the user just try again.
      if (sendError?.code === 4001) {
        alert(
          "Transaction was rejected in MetaMask. The page will refresh so you can try again.",
        );
        window.location.reload();
        return;
      }
      throw new Error(sendError.message || String(sendError));
    }

    // The rejection is already recorded on-chain and cannot be repeated
    // (a second rejectMilestone call reverts since the milestone is no
    // longer marked completed). Any failure from here on is a database
    // sync issue, not a failed rejection.
    try {
      await supabaseClient
        .from("milestones")
        .update({
          completed: false,
          completed_at: null,
        })
        .eq("agreement_id", submissionAgreementId)
        .eq("milestone_index", submissionMilestoneIndex);

      await TransactionRepository.record({
        transaction_hash: tx.transactionHash,
        agreement_id: submissionAgreementId,
        event_type: "MilestoneRejected",
        actor_address: account.toLowerCase(),
        details: {
          milestone_index: submissionMilestoneIndex,
          reason: reason,
          description: `Milestone rejected by Shipper: ${reason}`,
        },
      });
    } catch (syncError) {
      console.error(
        "Milestone rejected on-chain but Supabase sync failed:",
        syncError,
        "transaction hash:",
        tx.transactionHash,
      );
      alert(
        "The rejection was recorded on the blockchain " +
          `(transaction ${tx.transactionHash}), but saving the update to ` +
          "the database failed: " +
          (syncError?.message || String(syncError)) +
          "\n\nRefresh this page instead of rejecting again -- if the " +
          "status still looks wrong, contact support with the " +
          "transaction hash above.",
      );
      window.location.reload();
      return;
    }

    alert(
      "Milestone rejected. The carrier has been notified to re-submit evidence.",
    );
    window.location.href = "milestones.html";
  } catch (error) {
    alert(`Milestone rejection failed:\n\n${error.message || String(error)}`);
  }
}

async function getWalletAccount() {
  if (!window.ethereum) throw new Error("MetaMask is required.");
  const accounts = await window.ethereum.request({
    method: "eth_requestAccounts",
  });
  if (!accounts?.[0]) throw new Error("No MetaMask account is connected.");
  return accounts[0];
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value || "";
  return div.innerHTML;
}
function escapeAttribute(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}
