let submissionAgreement;
let submissionMilestone;
let submissionEvidence;
let submissionAgreementId;
let submissionMilestoneIndex;
let submissionMode;
let rejectionReason = null;

document.addEventListener("DOMContentLoaded", initialiseSubmissionPage);

async function initialiseSubmissionPage() {
    try {
        const params = new URLSearchParams(window.location.search);
        submissionAgreementId = Number(params.get("agreementId"));
        submissionMilestoneIndex = Number(params.get("milestoneIndex"));
        submissionMode = params.get("mode") === "review" ? "review" : "submit";

        if (!Number.isInteger(submissionAgreementId) || !Number.isInteger(submissionMilestoneIndex)) {
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

        const { data: rejectionTx } = await supabaseClient
            .from("transactions")
            .select("details, created_at")
            .eq("agreement_id", submissionAgreementId)
            .eq("event_type", "MilestoneRejected")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        const rejectionDetails = rejectionTx?.details;
        const isThisMilestoneRejected = rejectionDetails && Number(rejectionDetails.milestone_index) === submissionMilestoneIndex;
        rejectionReason = isThisMilestoneRejected ? rejectionDetails.reason : null;

        submissionAgreement = agreement;
        submissionMilestone = milestone;
        submissionEvidence = evidence;
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

function renderSubmissionPage() {
    const role = String(localStorage.getItem("role") || "").toLowerCase();
    const isCarrier = role === "carrier" || role === "2";
    const isShipper = role === "shipper" || role === "1";
    const checkpoint = submissionMilestone.checkpoint || `Milestone ${submissionMilestoneIndex + 1}`;

    const proofHtml = submissionEvidence?.proof_url
        ? `<img src="${escapeAttribute(submissionEvidence.proof_url)}" alt="Carrier submission proof" style="display:block; max-width:100%; max-height:480px; border-radius:10px; border:1px solid rgba(148,163,184,0.15);">`
        : "<span style=\"color:#64748b; font-style:italic;\">No submission photo provided.</span>";

    const submittedAtFormatted = submissionMilestone.completed_at ? new Date(submissionMilestone.completed_at).toLocaleString() : "—";
    const verifiedAtFormatted = submissionMilestone.verified_at ? new Date(submissionMilestone.verified_at).toLocaleString() : "Not verified yet";

    let workflowHtml = "";
    if (submissionMode === "submit" && !submissionMilestone.completed) {
        const canSubmit = isCarrier && submissionAgreement.status === "In Progress";
        
        let rejectionBannerHtml = "";
        if (isCarrier && rejectionReason) {
            rejectionBannerHtml = `
                <div style="background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.3); padding: 18px; border-radius: 14px; margin-bottom: 24px;">
                    <h4 style="color: #f87171; margin-bottom: 8px; font-size: 15px;"><i class="fa-solid fa-circle-exclamation"></i> Milestone Rejected by Shipper</h4>
                    <p style="color: #cbd5e1; font-size: 13px; margin: 0; white-space: pre-wrap; line-height: 1.6;">${escapeHtml(rejectionReason)}</p>
                </div>
            `;
        }

        workflowHtml = canSubmit ? `
            ${rejectionBannerHtml}
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
                        <input id="proof-file" type="file" accept="image/*" required style="display:block; color:#e0e1dd;">
                    </div>

                    <button class="primary-action-btn" type="submit"><i class="fa-solid fa-upload"></i> Submit Evidence & Completion</button>
                </div>
            </form>` : `<p style="color:#fbbf24; margin-top:15px;">Only the assigned Carrier can submit evidence for the active pending milestone.</p>`;
    } else {
        const canVerify = isShipper && submissionMilestone.completed && !submissionMilestone.verified && submissionEvidence;
        workflowHtml = `
        <div>
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

                <div style="display:flex; gap:12px; align-items: center;">
                    ${canVerify ? `
                        <button id="verify-evidence-btn" class="primary-action-btn" type="button"><i class="fa-solid fa-check-double"></i> Verify & Release Payment</button>
                        <button id="reject-evidence-btn" class="danger-action-btn" type="button"><i class="fa-solid fa-xmark"></i> Reject Milestone</button>
                    ` : (isCarrier ? '<p style="color:#8d99ae; font-style:italic;">Viewing submitted milestone details and proof.</p>' : '')}
                </div>

                <!-- Inline Rejection Bar (Initially Hidden) -->
                <div id="rejection-container" style="display:none; margin-top:24px; background:rgba(15,23,42,0.65); padding:20px; border-radius:14px; border:1px solid rgba(239, 68, 68, 0.3);">
                    <label class="detail-label" style="color:#f87171;">Reason for Rejection</label>
                    <textarea id="rejection-reason" rows="3" class="ca-inline-1e1541ba" placeholder="Enter the reason why this milestone submission is being rejected..." style="margin-bottom: 14px;"></textarea>
                    <div style="display:flex; gap:10px;">
                        <button id="confirm-reject-btn" class="danger-action-btn" type="button"><i class="fa-solid fa-paper-plane"></i> Confirm Rejection</button>
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

    document.getElementById("evidence-form")?.addEventListener("submit", submitEvidenceAndCompletion);
    document.getElementById("verify-evidence-btn")?.addEventListener("click", verifyEvidenceAndRelease);
    document.getElementById("reject-evidence-btn")?.addEventListener("click", () => {
        const rejContainer = document.getElementById("rejection-container");
        if (rejContainer) rejContainer.style.display = "block";
    });
    document.getElementById("cancel-reject-btn")?.addEventListener("click", () => {
        const rejContainer = document.getElementById("rejection-container");
        if (rejContainer) rejContainer.style.display = "none";
    });
    document.getElementById("confirm-reject-btn")?.addEventListener("click", rejectEvidenceAndReset);
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

    const button = event.submitter;
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Submitting…';
    try {
        const account = await getWalletAccount();
        if (account.toLowerCase() !== String(submissionAgreement.carrier_address || "").toLowerCase()) {
            throw new Error("Only the assigned Carrier can submit this evidence.");
        }
        const path = `${submissionAgreementId}/${submissionMilestoneIndex}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const { error: uploadError } = await supabaseClient.storage.from("milestone-evidence").upload(path, file, { upsert: false });
        if (uploadError) throw new Error(`Photo upload failed: ${uploadError.message}`);
        const proofUrl = supabaseClient.storage.from("milestone-evidence").getPublicUrl(path).data.publicUrl;
        const proofFileName = file.name;

        const web3 = new Web3(window.ethereum);
        const contract = new web3.eth.Contract(CONTRACT_ABI, CONTRACT_ADDRESS);
        const tx = await contract.methods.submitMilestoneCompletion(submissionAgreementId).send({ from: account });

        const { error: evidenceError } = await supabaseClient.from("milestone_evidence").upsert({
            agreement_id: submissionAgreementId, milestone_index: submissionMilestoneIndex,
            progress_notes: notes, proof_url: proofUrl || null, proof_file_name: proofFileName,
            submitted_by: account.toLowerCase(), transaction_hash: tx.transactionHash
        }, { onConflict: "agreement_id,milestone_index" });
        if (evidenceError) throw evidenceError;

        await supabaseClient.from("milestones").update({ completed: true, completed_at: new Date().toISOString() })
            .eq("agreement_id", submissionAgreementId).eq("milestone_index", submissionMilestoneIndex);
        await supabaseClient.from("transactions").insert({
            transaction_hash: tx.transactionHash, agreement_id: submissionAgreementId, event_type: "MilestoneSubmitted",
            actor_address: account.toLowerCase(), details: { milestone_index: submissionMilestoneIndex, description: "Carrier submitted milestone completion." }
        });
        alert("Evidence and milestone completion submitted. The Shipper can now review it.");
        window.location.href = "milestones.html";
    } catch (error) {
        alert(`Submission failed: ${error?.code === 4001 ? "Transaction was rejected in MetaMask." : error.message || String(error)}`);
        button.disabled = false;
        button.innerHTML = '<i class="fa-solid fa-upload"></i> Submit Evidence & Completion';
    }
}

async function verifyEvidenceAndRelease() {
    try {
        const account = await getWalletAccount();
        if (account.toLowerCase() !== String(submissionAgreement.shipper_address || "").toLowerCase()) throw new Error("Only the Shipper can verify this milestone.");
        if (!confirm("Verify this evidence and release the milestone payment to the Carrier?")) return;

        const web3 = new Web3(window.ethereum);
        const contract = new web3.eth.Contract(CONTRACT_ABI, CONTRACT_ADDRESS);
        const tx = await contract.methods.verifyMilestone(submissionAgreementId).send({ from: account });
        const chainAgreement = await contract.methods.getAgreementBasic(submissionAgreementId).call();
        const escrowTotal = Number(submissionAgreement.escrow_amount || 0);
        const payout = escrowTotal * Number(submissionMilestone.percentage) / 100;
        const now = new Date().toISOString();

        await supabaseClient.from("milestones").update({ completed: true, verified: true, paid: true, verified_at: now, paid_at: now })
            .eq("agreement_id", submissionAgreementId).eq("milestone_index", submissionMilestoneIndex);
        await supabaseClient.from("agreements").update({
            escrow_released: Number(submissionAgreement.escrow_released || 0) + payout,
            escrow_remaining: Number(Web3.utils.fromWei(String(chainAgreement.escrowRemaining), "ether")),
            current_milestone: Number(chainAgreement.currentMilestone),
            status: Number(chainAgreement.status) === 2 ? "Completed" : "In Progress",
            completed_at: Number(chainAgreement.status) === 2 ? Math.floor(Date.now() / 1000) : null
        }).eq("agreement_id", submissionAgreementId);
        await supabaseClient.from("transactions").insert({
            transaction_hash: tx.transactionHash, agreement_id: submissionAgreementId, event_type: "MilestoneVerified",
            actor_address: account.toLowerCase(), details: { milestone_index: submissionMilestoneIndex, amount: payout, description: `${payout.toFixed(3)} ETH released to Carrier.` }
        });
        alert("Evidence verified and payment released.");
        window.location.href = "milestones.html";
    } catch (error) {
        alert(`Verification failed: ${error?.code === 4001 ? "Transaction was rejected in MetaMask." : error.message || String(error)}`);
    }
}

async function rejectEvidenceAndReset() {
    try {
        const account = await getWalletAccount();
        if (account.toLowerCase() !== String(submissionAgreement.shipper_address || "").toLowerCase()) {
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
        
        const tx = await contract.methods.rejectMilestone(submissionAgreementId, reason).send({ from: account });

        await supabaseClient.from("milestones").update({ 
            completed: false, 
            completed_at: null 
        }).eq("agreement_id", submissionAgreementId).eq("milestone_index", submissionMilestoneIndex);

        await supabaseClient.from("transactions").insert({
            transaction_hash: tx.transactionHash, 
            agreement_id: submissionAgreementId, 
            event_type: "MilestoneRejected",
            actor_address: account.toLowerCase(), 
            details: { 
                milestone_index: submissionMilestoneIndex, 
                reason: reason,
                description: `Milestone rejected by Shipper: ${reason}` 
            }
        });

        alert("Milestone rejected. The carrier has been notified to re-submit evidence.");
        window.location.href = "milestones.html";
    } catch (error) {
        alert(`Rejection failed: ${error?.code === 4001 ? "Transaction was rejected in MetaMask." : error.message || String(error)}`);
    }
}

async function getWalletAccount() {
    if (!window.ethereum) throw new Error("MetaMask is required.");
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    if (!accounts?.[0]) throw new Error("No MetaMask account is connected.");
    return accounts[0];
}

function escapeHtml(value) { const div = document.createElement("div"); div.textContent = value || ""; return div.innerHTML; }
function escapeAttribute(value) { return escapeHtml(value).replace(/"/g, "&quot;"); }