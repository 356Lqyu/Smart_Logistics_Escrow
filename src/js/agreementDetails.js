// =====================================================
// AGREEMENT DETAILS
// =====================================================

let agreementId = null;
let agreementData = null;
let milestoneData = [];
let rejectionTransactionsMap = {};


// =====================================================
// PAGE INITIALIZATION
// =====================================================

document.addEventListener(
    "DOMContentLoaded",
    async () => {

        try {

            const params =
                new URLSearchParams(
                    window.location.search
                );

            agreementId =
                params.get("id");

            if (!agreementId) {
                throw new Error(
                    "No agreement ID was provided."
                );
            }

            // -------------------------------------------------
            // Load agreement
            // -------------------------------------------------

            await loadAgreement();

            // -------------------------------------------------
            // IMPORTANT:
            // Automatically process expiry before rendering.
            // -------------------------------------------------

            await processAgreementExpiry();

            // Reload after expiry in case blockchain/database
            // state was changed.
            await loadAgreement();

            await loadMilestones();

            renderAgreement();
            renderMilestones();
            renderLifecycle();
            setupActions();

            document.getElementById(
                "details-loading"
            ).style.display = "none";

            document.getElementById(
                "agreement-content"
            ).style.display = "block";

        } catch (error) {

            console.error(
                "Agreement details failed:",
                error
            );

            showError(
                error.message ||
                String(error)
            );
        }
    }
);


// =====================================================
// LOAD AGREEMENT
// =====================================================

async function loadAgreement() {

    const {
        data,
        error
    } =
        await supabaseClient
            .from("agreements")
            .select("*")
            .eq(
                "agreement_id",
                Number(agreementId)
            )
            .single();

    if (error) {
        throw error;
    }

    if (!data) {
        throw new Error(
            "Agreement was not found."
        );
    }

    agreementData =
        data;

    // -------------------------------------------------
    // Blockchain is authoritative
    // -------------------------------------------------

    if (
        typeof window.ethereum !==
        "undefined"
    ) {

        try {

            const web3 =
                new Web3(
                    window.ethereum
                );

            const contract =
                new web3.eth.Contract(
                    CONTRACT_ABI,
                    CONTRACT_ADDRESS
                );

            const chainAgreement =
                await contract.methods
                    .getAgreementBasic(
                        Number(agreementId)
                    )
                    .call();

            agreementData.blockchain_escrow =
                chainAgreement.escrowAmount;

            agreementData.blockchain_escrow_remaining =
                chainAgreement.escrowRemaining;

            agreementData.blockchain_shipper =
                chainAgreement.shipper;

            agreementData.blockchain_carrier =
                chainAgreement.carrier;

            agreementData.blockchain_status =
                Number(
                    chainAgreement.status
                );

            agreementData.blockchain_current_milestone =
                Number(
                    chainAgreement.currentMilestone
                );

            agreementData.blockchain_deadline =
                Number(
                    chainAgreement.deadline
                );

        } catch (error) {

            console.warn(
                "Could not load blockchain agreement:",
                error
            );
        }
    }
}


// =====================================================
// PROCESS AGREEMENT EXPIRY
// =====================================================
//
// IMPORTANT:
//
// Expiry is determined by the blockchain deadline.
//
// If:
//      current time > deadline
//
// and the blockchain agreement is not already Completed,
// Cancelled or Expired:
//
//      call expireAgreement()
//
// The smart contract must refund remaining escrow
// to the Shipper and change blockchain status to Expired.
//
// =====================================================

async function processAgreementExpiry() {

    if (!agreementData) {
        return;
    }

    const deadline =
        Number(
            agreementData.blockchain_deadline ||
            agreementData.deadline ||
            0
        );

    if (!deadline) {
        return;
    }

    const now =
        Math.floor(
            Date.now() / 1000
        );

    // Agreement has not expired yet.
    if (now <= deadline) {
        return;
    }

    // Do NOT expire if the agreement is already Completed, Cancelled, or Expired
    const blockchainStatus =
        Number(
            agreementData.blockchain_status || 0
        );
    if (blockchainStatus === 2 || blockchainStatus === 3) {
        return;
    }

    // Already expired
    if (blockchainStatus === 4) {

        await syncExpiredAgreementToSupabase();

        return;
    }

    // -------------------------------------------------
    // Blockchain expiry
    // -------------------------------------------------

    if (
        typeof window.ethereum ===
        "undefined"
    ) {

        console.warn(
            "MetaMask unavailable. Agreement is expired by deadline but blockchain expiry could not be processed."
        );

        return;
    }

    try {

        const web3 =
            new Web3(
                window.ethereum
            );

        const contract =
            new web3.eth.Contract(
                CONTRACT_ABI,
                CONTRACT_ADDRESS
            );

        const accounts =
            await window.ethereum.request({
                method:
                    "eth_requestAccounts"
            });

        if (
            !accounts ||
            accounts.length === 0
        ) {
            console.warn(
                "No wallet connected. Expiry transaction cannot be submitted."
            );

            return;
        }

        const account =
            accounts[0];

        console.log(
            "Agreement deadline passed. Attempting blockchain expiry..."
        );

        // -------------------------------------------------
        // Check current blockchain state again.
        // -------------------------------------------------

        const chainAgreement =
            await contract.methods
                .getAgreementBasic(
                    Number(agreementId)
                )
                .call();

        const currentStatus =
            Number(
                chainAgreement.status
            );

        // Only the agreement owner can confirm expiry and receive the refund.
        // Carriers are informed through the disabled milestone controls instead.
        if (
            account.toLowerCase() !==
            chainAgreement.shipper.toLowerCase()
        ) {
            return;
        }

        // Completed / Cancelled
        if (
            currentStatus === 2 ||
            currentStatus === 3
        ) {
            return;
        }

        // Already expired
        if (
            currentStatus === 4
        ) {

            agreementData.blockchain_status =
                4;

            await syncExpiredAgreementToSupabase();

            return;
        }

        // -------------------------------------------------
        // Confirm expiry
        // -------------------------------------------------

        const confirmed =
            confirm(
                "This agreement has passed its deadline.\n\n" +
                "You are the Shipper. Confirm the expiry transaction to refund the remaining escrow to your wallet and mark this agreement as Expired.\n\n" +
                "Continue?"
            );

        if (!confirmed) {
            return;
        }

        // -------------------------------------------------
        // Execute blockchain expiry
        // -------------------------------------------------

        const tx =
            await contract.methods
                .expireAgreement(
                    Number(agreementId)
                )
                .send({
                    from:
                        account
                });

        console.log(
            "Agreement expired on blockchain:",
            tx.transactionHash
        );

        // -------------------------------------------------
        // Update Supabase
        // -------------------------------------------------

        await syncExpiredAgreementToSupabase(
            tx.transactionHash,
            account
        );

        alert(
            "Agreement expired successfully.\n\n" +
            "The remaining escrow has been refunded to the Shipper."
        );

        // Reload page state
        await loadAgreement();

    } catch (error) {

        console.error(
            "Agreement expiry failed:",
            error
        );

        if (
            error?.code === 4001
        ) {

            alert(
                "Expiry transaction was rejected in MetaMask."
            );

            return;
        }

        console.warn(
            "Could not automatically expire agreement:",
            error
        );
    }
}


// =====================================================
// SYNC EXPIRED AGREEMENT TO SUPABASE
// =====================================================

async function syncExpiredAgreementToSupabase(
    transactionHash = null,
    actor = null
) {

    try {

        const remainingWei =
            agreementData
                ?.blockchain_escrow_remaining;

        let remainingEth = 0;

        if (
            remainingWei !==
            undefined &&
            remainingWei !==
            null
        ) {

            remainingEth =
                getBlockchainEth(
                    remainingWei,
                    0
                );

        } else {

            remainingEth =
                Number(
                    agreementData.escrow_remaining ||
                    0
                );
        }

        // -------------------------------------------------
        // Update agreement
        // -------------------------------------------------

        const {
            error
        } =
            await supabaseClient
                .from("agreements")
                .update({

                    status:
                        "Expired",

                    expired_at:
                        Math.floor(
                            Date.now() / 1000
                        ),

                    refunded_amount:
                        remainingEth,

                    escrow_remaining:
                        0,

                    escrow_released:
                        Number(
                            agreementData.escrow_released ||
                            0
                        ) +
                        remainingEth
                })
                .eq(
                    "agreement_id",
                    Number(agreementId)
                );

        if (error) {

            console.error(
                "Failed to update expired agreement in Supabase:",
                error
            );

            return;
        }

        // -------------------------------------------------
        // Save transaction
        // -------------------------------------------------

        if (
            transactionHash &&
            actor
        ) {

            await saveTransaction(
                transactionHash,
                "AgreementExpired",
                actor,
                {
                    status:
                        "Expired",

                    escrow_refunded:
                        remainingEth,

                    description:
                        "Agreement expired after the deadline. Remaining escrow was refunded to the Shipper."
                }
            );
        }

        // Update local state
        agreementData.status =
            "Expired";

        agreementData.expired_at =
            Math.floor(
                Date.now() / 1000
            );

        agreementData.escrow_remaining =
            0;

        agreementData.refunded_amount =
            remainingEth;

        agreementData.blockchain_status =
            4;

    } catch (error) {

        console.error(
            "Expired agreement synchronization failed:",
            error
        );
    }
}


// =====================================================
// LOAD MILESTONES
// =====================================================

async function loadMilestones() {

    const {
        data,
        error
    } =
        await supabaseClient
            .from("milestones")
            .select(`
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
            `)
            .eq(
                "agreement_id",
                Number(agreementId)
            )
            .order(
                "milestone_index",
                {
                    ascending:
                        true
                }
            );

    if (error) {
        throw error;
    }

    milestoneData =
        data || [];

    const { data: rejectionTransactions } = await supabaseClient
        .from("transactions")
        .select("agreement_id, details")
        .eq("agreement_id", Number(agreementId))
        .eq("event_type", "MilestoneRejected")
        .order("created_at", { ascending: false });

    milestoneData.forEach(milestone => {
        milestone.isRejected = false;
        milestone.rejectionReason = null;

        if (rejectionTransactions) {
            const match = rejectionTransactions.find(tx =>
                Number(tx.details?.milestone_index) === Number(milestone.milestone_index)
            );
            if (match && !normalizeBool(milestone.completed)) {
                milestone.isRejected = true;
                milestone.rejectionReason = match.details.reason;
            }
        }
    });

    // -------------------------------------------------
    // Prefer blockchain milestone state
    // -------------------------------------------------

    if (
        typeof window.ethereum !==
        "undefined"
    ) {

        try {

            const web3 =
                new Web3(
                    window.ethereum
                );

            const contract =
                new web3.eth.Contract(
                    CONTRACT_ABI,
                    CONTRACT_ADDRESS
                );

            const count =
                Number(
                    await contract.methods
                        .getMilestoneCount(
                            Number(agreementId)
                        )
                        .call()
                );

            if (
                count ===
                milestoneData.length
            ) {

                for (
                    let i = 0;
                    i < count;
                    i++
                ) {

                    const chain =
                        await contract.methods
                            .getMilestone(
                                Number(agreementId),
                                i
                            )
                            .call();

                    milestoneData[i].completed =
                        normalizeBool(
                            chain.completed
                        );

                    milestoneData[i].verified =
                        normalizeBool(
                            chain.verified
                        );

                    milestoneData[i].paid =
                        normalizeBool(
                            chain.paid
                        );

                    milestoneData[i].completed_at =
                        Number(
                            chain.completedAt
                        ) ||
                        null;

                    milestoneData[i].verified_at =
                        Number(
                            chain.verifiedAt
                        ) ||
                        null;
                }
            }

        } catch (error) {

            console.warn(
                "Could not load blockchain milestones:",
                error
            );
        }
    }
}


// =====================================================
// RENDER AGREEMENT
// =====================================================

function renderAgreement() {

    const status =
        agreementData.status ||
        getStatusFromBlockchain() ||
        "Created";

    setText(
        "agreement-reference",
        agreementData.reference_no ||
        "-"
    );

    setText(
        "agreement-shipment",
        agreementData.shipment_details ||
        "-"
    );

    const statusElement =
        document.getElementById(
            "agreement-status"
        );

    if (statusElement) {

        statusElement.innerHTML = `
            <span class="status-dot"></span>
            ${escapeHtml(status)}
        `;

        statusElement.className =
            "status-badge " +
            getStatusClass(
                status
            );
    }

    const priority =
        agreementData.priority ||
        "Normal";

    setText(
        "agreement-priority",
        priority.toUpperCase()
    );

    setText(
        "shipper-address",
        shortenAddress(
            agreementData.blockchain_shipper ||
            agreementData.shipper_address
        )
    );

    setText(
        "carrier-address",
        getCarrierAddress()
    );

    // -------------------------------------------------
    // Escrow
    // -------------------------------------------------

    const escrowEth =
        getBlockchainEth(
            agreementData.blockchain_escrow,
            agreementData.escrow_amount
        );

    setText(
        "escrow-amount",
        `${escrowEth.toFixed(3)} ETH`
    );

    // -------------------------------------------------
    // Deadline
    // -------------------------------------------------

    const deadline =
        Number(
            agreementData.blockchain_deadline ||
            agreementData.deadline
        );

    setText(
        "agreement-deadline",
        formatDate(
            deadline
        )
    );

    if (deadline) {

        updateCountdown(
            deadline
        );
    }

    // -------------------------------------------------
    // Network
    // -------------------------------------------------

    detectNetwork();

    // -------------------------------------------------
    // Etherscan
    // -------------------------------------------------

    const explorer =
        document.getElementById(
            "etherscan-link"
        );

    if (explorer) {

        explorer.href =
            `https://etherscan.io/address/${CONTRACT_ADDRESS}`;
    }

    // -------------------------------------------------
    // Shipment details
    // -------------------------------------------------

    setText(
        "detail-shipment",
        agreementData.shipment_details ||
        "-"
    );

    const payload =
        Number(
            agreementData.payload_value ||
            0
        );

    setText(
        "detail-payload-value",
        `$${payload.toLocaleString(
            undefined,
            {
                minimumFractionDigits:
                    2,
                maximumFractionDigits:
                    2
            }
        )}`
    );

    setText(
        "detail-priority",
        priority
    );

    setText(
        "detail-origin",
        agreementData.origin ||
        "-"
    );

    setText(
        "detail-destination",
        agreementData.destination ||
        "-"
    );

    // -------------------------------------------------
    // Financial section visibility
    // -------------------------------------------------

    const financialSection =
        document.querySelector(
            ".shipment-agreement-card"
        );

    const role =
        String(
            localStorage.getItem(
                "role"
            ) ||
            ""
        ).toLowerCase();

    const isCarrier =
        role === "2" ||
        role === "carrier";

    if (financialSection) {

        const subsections =
            financialSection.querySelectorAll(
                ".detail-subsection"
            );

        if (
            subsections.length >=
            3
        ) {

            subsections[2].style.display =
                (
                    isCarrier &&
                    status ===
                    "Created"
                )
                    ? "none"
                    : "block";
        }
    }

    setText(
        "detail-escrow-amount",
        `${escrowEth.toFixed(3)} ETH`
    );

    const released =
        Number(
            agreementData.escrow_released ||
            0
        );

    const remaining =
        getBlockchainEth(
            agreementData.blockchain_escrow_remaining,
            agreementData.escrow_remaining
        );

    setText(
        "detail-escrow-released",
        `${released.toFixed(3)} ETH`
    );

    setText(
        "detail-escrow-remaining",
        `${remaining.toFixed(3)} ETH`
    );
}


// =====================================================
// GET STATUS FROM BLOCKCHAIN
// =====================================================

function getStatusFromBlockchain() {

    const status =
        Number(
            agreementData?.blockchain_status
        );

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


// =====================================================
// MILESTONES
// =====================================================

function renderMilestones() {

    const container =
        document.getElementById(
            "milestones-container"
        );

    if (!container) {
        return;
    }

    container.innerHTML =
        "";

    if (
        !milestoneData ||
        milestoneData.length === 0
    ) {

        container.innerHTML = `
            <div class="milestone-empty">
                No milestones found.
            </div>
        `;

        updateOverallProgress();

        return;
    }

    const status =
        agreementData.status;

    let currentIndex =
        Number(
            agreementData.blockchain_current_milestone
        );

    if (
        !Number.isInteger(
            currentIndex
        ) ||
        currentIndex < 0
    ) {

        currentIndex =
            findFirstUnpaidMilestone();
    }

    if (
        currentIndex >=
        milestoneData.length
    ) {

        currentIndex =
            -1;
    }

    const role =
        String(
            localStorage.getItem(
                "role"
            ) ||
            ""
        ).toLowerCase();

    const isCarrier =
        role === "2" ||
        role === "carrier";

    const isShipper =
        role === "1" ||
        role === "shipper";

    milestoneData.forEach(
        (
            milestone,
            index
        ) => {

            const completed =
                normalizeBool(
                    milestone.completed
                );

            const verified =
                normalizeBool(
                    milestone.verified
                );

            const paid =
                normalizeBool(
                    milestone.paid
                );

            const percentage =
                Number(
                    milestone.percentage ||
                    0
                );

            const checkpoint =
                milestone.checkpoint ||
                `Milestone ${index + 1}`;

            const amount =
                calculateMilestoneAmount(
                    percentage
                );

            let state = "pending";
            let stateText = "Pending";

            if (status === "Expired") {
                state = "expired";
                stateText = "Expired";
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

            let action = "";

            // -------------------------------------------------
            // Priority check for rejections
            // -------------------------------------------------
            if (milestone.isRejected) {
                action = `
                    <button
                        type="button"
                        class="danger-action-btn"
                        style="margin-top: 12px; padding: 8px 14px; font-size: 12px; background: #ef4444;"
                        onclick="openMilestoneSubmission(${agreementId}, ${index}, 'submit')"
                    >
                        <i class="fa-solid fa-triangle-exclamation"></i>
                        View Rejection Reason & Re-submit
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
            }
            else if (
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

            const item =
                document.createElement(
                    "div"
                );

            item.className =
                `milestone-item ${state}`;

            const numberContent =
                (
                    completed &&
                    verified &&
                    paid
                )
                    ? '<i class="fa-solid fa-check"></i>'
                    : index + 1;

            item.innerHTML = `
                <div class="milestone-left">

                    <div class="milestone-number">
                        ${numberContent}
                    </div>

                    <div class="milestone-info">

                        <h3>
                            ${escapeHtml(
                checkpoint
            )}
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

                        ${status === "Expired"
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

                        ${completed &&
                    !verified &&
                    status !== "Expired"
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

                        ${completed &&
                    verified &&
                    paid
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

            container.appendChild(
                item
            );
        }
    );

    updateOverallProgress();
}


// =====================================================
// CHECK EXPIRY
// =====================================================

function isAgreementExpired() {

    const deadline =
        Number(
            agreementData?.blockchain_deadline ||
            agreementData?.deadline ||
            0
        );

    if (!deadline) {
        return false;
    }

    return (
        Math.floor(
            Date.now() / 1000
        ) > deadline
    );
}


// =====================================================
// CARRIER SUBMITS COMPLETION
// =====================================================

async function submitMilestoneCompletion(
    id
) {

    try {

        // -------------------------------------------------
        // HARD EXPIRY CHECK
        // -------------------------------------------------

        if (
            isAgreementExpired()
        ) {

            await processAgreementExpiry();

            throw new Error(
                "This agreement has expired. The remaining escrow must be refunded to the Shipper. Milestone submissions are no longer allowed."
            );
        }

        if (
            agreementData.status !==
            "In Progress"
        ) {

            throw new Error(
                "The agreement is not In Progress."
            );
        }

        if (
            typeof window.ethereum ===
            "undefined"
        ) {

            throw new Error(
                "MetaMask is required."
            );
        }

        const accounts =
            await window.ethereum.request({
                method:
                    "eth_requestAccounts"
            });

        const account =
            accounts[0];

        const carrier =
            getCarrierAddressRaw();

        if (
            carrier &&
            account.toLowerCase() !==
            carrier.toLowerCase()
        ) {

            throw new Error(
                "Only the assigned Carrier can submit milestone completion."
            );
        }

        const index =
            getCurrentMilestoneIndex();

        if (
            index < 0
        ) {

            throw new Error(
                "There is no pending milestone."
            );
        }

        const milestone =
            milestoneData[index];

        if (
            normalizeBool(
                milestone.completed
            )
        ) {

            throw new Error(
                "This milestone is already awaiting verification or completed."
            );
        }

        const web3 =
            new Web3(
                window.ethereum
            );

        const contract =
            new web3.eth.Contract(
                CONTRACT_ABI,
                CONTRACT_ADDRESS
            );

        // -------------------------------------------------
        // Check blockchain status again
        // -------------------------------------------------

        const chainAgreement =
            await contract.methods
                .getAgreementBasic(
                    Number(id)
                )
                .call();

        const chainStatus =
            Number(
                chainAgreement.status
            );

        if (
            chainStatus === 4
        ) {

            await syncExpiredAgreementToSupabase();

            throw new Error(
                "This agreement has expired. The escrow has been refunded to the Shipper."
            );
        }

        // -------------------------------------------------
        // Check deadline again
        // -------------------------------------------------

        const chainDeadline =
            Number(
                chainAgreement.deadline
            );

        if (
            chainDeadline &&
            Math.floor(
                Date.now() / 1000
            ) >
            chainDeadline
        ) {

            await processAgreementExpiry();

            throw new Error(
                "This agreement has expired. Milestone submission is no longer allowed."
            );
        }

        const confirmed =
            confirm(
                `Submit completion for "${milestone.checkpoint}"?\n\n` +
                "MetaMask will ask you to confirm the blockchain transaction."
            );

        if (!confirmed) {
            return;
        }

        const button =
            findMilestoneActionButton(
                "Submit Completion"
            );

        if (button) {

            button.disabled =
                true;

            button.innerHTML =
                '<i class="fa-solid fa-spinner fa-spin"></i> Submitting...';
        }

        const tx =
            await contract.methods
                .submitMilestoneCompletion(
                    Number(id)
                )
                .send({
                    from:
                        account
                });

        await supabaseClient
            .from("milestones")
            .update({
                completed:
                    true,

                completed_at:
                    new Date().toISOString()
            })
            .eq(
                "agreement_id",
                Number(id)
            )
            .eq(
                "milestone_index",
                index
            );

        await saveTransaction(
            tx.transactionHash,
            "MilestoneSubmitted",
            account,
            {
                milestone_index:
                    index,

                checkpoint:
                    milestone.checkpoint,

                percentage:
                    milestone.percentage,

                status:
                    "Awaiting Verification",

                description:
                    "Carrier submitted milestone completion. Waiting for Shipper verification."
            }
        );

        alert(
            "Milestone completion submitted successfully.\n\n" +
            "Status: Awaiting Verification"
        );

        await loadAgreement();
        await loadMilestones();

        renderAgreement();
        renderMilestones();
        renderLifecycle();
        setupActions();

    } catch (error) {

        console.error(
            "Submit completion failed:",
            error
        );

        alert(
            "Failed to submit milestone completion:\n\n" +
            (
                error?.code === 4001
                    ? "Transaction was rejected in MetaMask."
                    : error?.message ||
                    String(error)
            )
        );

        renderMilestones();
    }
}


// =====================================================
// SHIPPER VERIFIES + RELEASES
// =====================================================

async function verifyMilestone(
    id
) {

    try {

        if (
            isAgreementExpired()
        ) {

            await processAgreementExpiry();

            throw new Error(
                "This agreement has expired. Milestone verification is no longer allowed."
            );
        }

        if (
            agreementData.status !==
            "In Progress"
        ) {

            throw new Error(
                "The agreement is not In Progress."
            );
        }

        if (
            typeof window.ethereum ===
            "undefined"
        ) {

            throw new Error(
                "MetaMask is required."
            );
        }

        const accounts =
            await window.ethereum.request({
                method:
                    "eth_requestAccounts"
            });

        const account =
            accounts[0];

        const shipper =
            (
                agreementData.blockchain_shipper ||
                agreementData.shipper_address ||
                ""
            ).toLowerCase();

        if (
            account.toLowerCase() !==
            shipper
        ) {

            throw new Error(
                "Only the Shipper can verify a milestone."
            );
        }

        const index =
            getCurrentMilestoneIndex();

        if (
            index < 0
        ) {

            throw new Error(
                "There is no milestone awaiting verification."
            );
        }

        const milestone =
            milestoneData[index];

        if (
            !normalizeBool(
                milestone.completed
            )
        ) {

            throw new Error(
                "Carrier has not submitted this milestone."
            );
        }

        if (
            normalizeBool(
                milestone.verified
            ) ||
            normalizeBool(
                milestone.paid
            )
        ) {

            throw new Error(
                "This milestone has already been paid."
            );
        }

        const payout =
            calculateMilestoneAmount(
                milestone.percentage
            );

        const web3 =
            new Web3(
                window.ethereum
            );

        const contract =
            new web3.eth.Contract(
                CONTRACT_ABI,
                CONTRACT_ADDRESS
            );

        const confirmed =
            confirm(
                `Verify "${milestone.checkpoint}" and release ${payout} ETH to the Carrier?\n\n` +
                "The smart contract will verify the Shipper, milestone, completion and payment state."
            );

        if (!confirmed) {
            return;
        }

        const button =
            findMilestoneActionButton(
                "Verify & Release Payment"
            );

        if (button) {

            button.disabled =
                true;

            button.innerHTML =
                '<i class="fa-solid fa-spinner fa-spin"></i> Verifying...';
        }

        const tx =
            await contract.methods
                .verifyMilestone(
                    Number(id)
                )
                .send({
                    from:
                        account
                });

        const now =
            new Date().toISOString();

        await supabaseClient
            .from("milestones")
            .update({
                completed:
                    true,

                verified:
                    true,

                paid:
                    true,

                verified_at:
                    now,

                paid_at:
                    now
            })
            .eq(
                "agreement_id",
                Number(id)
            )
            .eq(
                "milestone_index",
                index
            );

        const payoutNumber =
            Number(
                payout
            );

        const oldReleased =
            Number(
                agreementData.escrow_released ||
                0
            );

        const oldRemaining =
            Number(
                agreementData.escrow_remaining ||
                agreementData.escrow_amount ||
                0
            );

        const allPaid =
            index ===
            milestoneData.length - 1;

        await supabaseClient
            .from("agreements")
            .update({
                escrow_released:
                    oldReleased +
                    payoutNumber,

                escrow_remaining:
                    Math.max(
                        0,
                        oldRemaining -
                        payoutNumber
                    ),

                current_milestone:
                    index + 1,

                status:
                    allPaid
                        ? "Completed"
                        : "In Progress",

                completed_at:
                    allPaid
                        ? Math.floor(
                            Date.now() / 1000
                        )
                        : null
            })
            .eq(
                "agreement_id",
                Number(id)
            );

        await saveTransaction(
            tx.transactionHash,
            "MilestoneVerified",
            account,
            {
                milestone_index:
                    index,

                checkpoint:
                    milestone.checkpoint,

                percentage:
                    milestone.percentage,

                amount:
                    payout,

                status:
                    "Completed & Paid",

                description:
                    "Shipper verified the milestone."
            }
        );

        await saveTransaction(
            tx.transactionHash + "-payout",
            "MilestonePayout",
            account,
            {
                milestone_index:
                    index,

                checkpoint:
                    milestone.checkpoint,

                amount:
                    payout,

                status:
                    "Completed & Paid",

                description:
                    `${payout} ETH released to Carrier.`
            }
        );

        if (allPaid) {

            await saveTransaction(
                tx.transactionHash + "-completed",
                "AgreementCompleted",
                account,
                {
                    status:
                        "Completed",

                    description:
                        "All milestones completed, verified and paid."
                }
            );
        }

        alert(
            `Milestone verified successfully.\n\n` +
            `${payout} ETH released to Carrier.` +
            (
                allPaid
                    ? "\n\nAgreement completed."
                    : "\n\nThe next milestone is now active."
            )
        );

        await loadAgreement();
        await loadMilestones();

        renderAgreement();
        renderMilestones();
        renderLifecycle();
        setupActions();

    } catch (error) {

        console.error(
            "Verify milestone failed:",
            error
        );

        alert(
            "Failed to verify milestone:\n\n" +
            (
                error?.code === 4001
                    ? "Transaction was rejected in MetaMask."
                    : error?.message ||
                    String(error)
            )
        );

        renderMilestones();
    }
}


// =====================================================
// CURRENT MILESTONE
// =====================================================

function getCurrentMilestoneIndex() {

    const blockchainIndex =
        Number(
            agreementData
                ?.blockchain_current_milestone
        );

    if (
        Number.isInteger(
            blockchainIndex
        ) &&
        blockchainIndex >= 0 &&
        blockchainIndex <
        milestoneData.length
    ) {

        return blockchainIndex;
    }

    return findFirstUnpaidMilestone();
}


function findFirstUnpaidMilestone() {

    for (
        let i = 0;
        i < milestoneData.length;
        i++
    ) {

        const paid =
            normalizeBool(
                milestoneData[i].paid
            );

        if (!paid) {
            return i;
        }
    }

    return -1;
}


// =====================================================
// CALCULATE PAYOUT DISPLAY
// =====================================================

function calculateMilestoneAmount(
    percentage
) {

    const escrowEth =
        getBlockchainEth(
            agreementData?.blockchain_escrow,
            agreementData?.escrow_amount
        );

    return (
        escrowEth *
        Number(percentage) /
        100
    ).toFixed(3);
}


// =====================================================
// OVERALL PROGRESS
// =====================================================

function updateOverallProgress() {

    const progressText =
        document.getElementById(
            "overall-progress"
        );

    const progressBar =
        document.getElementById(
            "overall-progress-bar"
        );

    let completedPercentage =
        0;

    milestoneData.forEach(
        milestone => {

            const completed =
                normalizeBool(
                    milestone.completed
                );

            const verified =
                normalizeBool(
                    milestone.verified
                );

            const paid =
                normalizeBool(
                    milestone.paid
                );

            if (
                completed &&
                verified &&
                paid
            ) {

                completedPercentage +=
                    Number(
                        milestone.percentage ||
                        0
                    );
            }
        }
    );

    if (progressText) {

        progressText.innerText =
            `${completedPercentage}%`;
    }

    if (progressBar) {

        progressBar.style.width =
            `${Math.min(
                completedPercentage,
                100
            )}%`;
    }
}


// =====================================================
// LIFECYCLE
// =====================================================

function renderLifecycle() {

    const container =
        document.getElementById(
            "lifecycle-timeline"
        );

    if (!container) {
        return;
    }

    const status =
        agreementData.status ||
        getStatusFromBlockchain() ||
        "Created";

    // -------------------------------------------------
    // CANCELLED
    // -------------------------------------------------

    if (
        status ===
        "Cancelled"
    ) {

        renderLifecycleStages(
            container,
            [
                {
                    label:
                        "Created",

                    state:
                        "completed"
                },

                {
                    label:
                        "Cancelled",

                    state:
                        "cancelled"
                },

                {
                    label:
                        "Refunded",

                    state:
                        "refunded"
                }
            ]
        );

        return;
    }

    // -------------------------------------------------
    // EXPIRED
    // -------------------------------------------------

    if (
        status ===
        "Expired"
    ) {

        renderLifecycleStages(
            container,
            [
                {
                    label:
                        "Created",

                    state:
                        "completed"
                },

                {
                    label:
                        "Accepted",

                    state:
                        agreementData.blockchain_carrier &&
                            !isZeroAddress(
                                agreementData.blockchain_carrier
                            )
                            ? "completed"
                            : "pending"
                },

                {
                    label:
                        "Expired",

                    state:
                        "expired"
                },

                {
                    label:
                        "Refunded",

                    state:
                        "refunded"
                }
            ]
        );

        return;
    }

    // -------------------------------------------------
    // NORMAL
    // -------------------------------------------------

    const stages = [
        {
            label:
                "Created",

            state:
                "completed"
        },

        {
            label:
                "Accepted",

            state:
                "pending"
        }
    ];

    const carrier =
        getCarrierAddressRaw();

    if (
        carrier &&
        !isZeroAddress(
            carrier
        )
    ) {

        stages[1].state =
            "completed";

    } else if (
        status ===
        "Created"
    ) {

        stages[1].state =
            "pending";
    }

    milestoneData.forEach(
        milestone => {

            const completed =
                normalizeBool(
                    milestone.completed
                );

            const verified =
                normalizeBool(
                    milestone.verified
                );

            const paid =
                normalizeBool(
                    milestone.paid
                );

            let stageState = "pending";
            if (completed && verified && paid) {
                stageState = "completed";
            } else if (milestone.isRejected) {
                stageState = "cancelled"; // triggers red color theme
            } else if (completed) {
                stageState = "active";
            }

            stages.push({
                label: milestone.checkpoint,
                state: stageState
            });
        }
    );

    stages.push({

        label:
            "Completed",

        state:
            status ===
                "Completed"
                ? "completed"
                : "pending"
    });

    renderLifecycleStages(
        container,
        stages
    );
}


// =====================================================
// RENDER LIFECYCLE STAGES
// =====================================================

function renderLifecycleStages(
    container,
    stages
) {

    let html =
        "";

    stages.forEach(
        (
            stage,
            index
        ) => {

            let className =
                "pending";

            if (
                stage.state ===
                "completed"
            ) {

                className =
                    "completed";

            } else if (
                stage.state ===
                "active"
            ) {

                className =
                    "active";

            } else if (
                stage.state ===
                "cancelled"
            ) {

                className =
                    "cancelled";

            } else if (
                stage.state ===
                "expired"
            ) {

                className =
                    "expired";

            } else if (
                stage.state ===
                "refunded"
            ) {

                className =
                    "refunded";
            }

            let circle =
                index + 1;

            if (
                stage.state ===
                "completed"
            ) {

                circle =
                    '<i class="fa-solid fa-check"></i>';

            } else if (
                stage.state ===
                "cancelled"
            ) {

                circle =
                    '<i class="fa-solid fa-xmark"></i>';

            } else if (
                stage.state ===
                "expired"
            ) {

                circle =
                    '<i class="fa-solid fa-clock"></i>';

            } else if (
                stage.state ===
                "refunded"
            ) {

                circle =
                    '<i class="fa-solid fa-rotate-left"></i>';
            }

            html += `
                <div class="timeline-stage ${className}">

                    <div class="timeline-circle">
                        ${circle}
                    </div>

                    <span>
                        ${escapeHtml(
                stage.label
            )}
                    </span>

                </div>
            `;
        }
    );

    container.innerHTML =
        html;
}


// =====================================================
// ACTIONS
// =====================================================

function setupActions() {

    const cancelButton =
        document.getElementById(
            "cancel-btn"
        );

    const role =
        String(
            localStorage.getItem(
                "role"
            ) ||
            ""
        ).toLowerCase();

    const isShipper =
        role === "1" ||
        role === "shipper";

    const isCarrier =
        role === "2" ||
        role === "carrier";

    // -------------------------------------------------
    // EXPIRED
    // -------------------------------------------------

    if (
        agreementData.status ===
        "Expired"
    ) {

        if (cancelButton) {

            cancelButton.style.display =
                "none";
        }

        return;
    }

    // -------------------------------------------------
    // CANCEL / ACCEPT
    // -------------------------------------------------

    if (cancelButton) {

        // An expired agreement must be confirmed by its Shipper. This applies
        // both before acceptance (Created) and after acceptance (In Progress).
        if (
            isShipper &&
            isAgreementExpired() &&
            (
                agreementData.status === "Created" ||
                agreementData.status === "In Progress"
            )
        ) {

            cancelButton.style.display = "inline-flex";
            cancelButton.disabled = false;
            cancelButton.className = "danger-action-btn";
            cancelButton.innerHTML = `
                <i class="fa-solid fa-clock"></i>
                Confirm Expiry & Refund
            `;
            cancelButton.onclick = processAgreementExpiry;
        }

        // Shipper can cancel Created
        else if (
            isShipper &&
            agreementData.status ===
            "Created"
        ) {

            cancelButton.style.display =
                "inline-flex";

            cancelButton.disabled =
                false;

            cancelButton.className =
                "danger-action-btn";

            cancelButton.innerHTML = `
                <i class="fa-solid fa-xmark"></i>
                Cancel Agreement
            `;

            cancelButton.onclick =
                cancelAgreement;

        }

        // Carrier can accept Created
        else if (
            isCarrier &&
            agreementData.status ===
            "Created" &&
            !isAgreementExpired()
        ) {

            cancelButton.style.display =
                "inline-flex";

            cancelButton.disabled =
                false;

            cancelButton.className =
                "primary-action-btn";

            cancelButton.innerHTML = `
                <i class="fa-solid fa-check"></i>
                Accept Agreement
            `;

            cancelButton.onclick =
                acceptAgreementDetailsAction;

        }

        else {

            cancelButton.style.display =
                "none";
        }
    }
}


// =====================================================
// ACCEPT AGREEMENT
// =====================================================

async function acceptAgreementDetailsAction() {

    try {

        // -------------------------------------------------
        // NEVER allow accepting after deadline
        // -------------------------------------------------

        if (
            isAgreementExpired()
        ) {

            await processAgreementExpiry();

            throw new Error(
                "This agreement has expired. It can no longer be accepted."
            );
        }

        if (
            typeof window.ethereum ===
            "undefined"
        ) {

            throw new Error(
                "MetaMask is required."
            );
        }

        const accounts =
            await window.ethereum.request({
                method:
                    "eth_requestAccounts"
            });

        if (
            !accounts ||
            accounts.length === 0
        ) {

            throw new Error(
                "No wallet connected."
            );
        }

        const currentAccount =
            accounts[0];

        const web3 =
            new Web3(
                window.ethereum
            );

        const contract =
            new web3.eth.Contract(
                CONTRACT_ABI,
                CONTRACT_ADDRESS
            );

        // -------------------------------------------------
        // Check blockchain state
        // -------------------------------------------------

        const chainAgreement =
            await contract.methods
                .getAgreementBasic(
                    Number(agreementId)
                )
                .call();

        const deadline =
            Number(
                chainAgreement.deadline
            );

        if (
            deadline &&
            Math.floor(
                Date.now() / 1000
            ) >
            deadline
        ) {

            await processAgreementExpiry();

            throw new Error(
                "This agreement has expired and cannot be accepted."
            );
        }

        const confirmed =
            confirm(
                "Accept this logistics agreement?\n\n" +
                "After acceptance, the agreement becomes In Progress."
            );

        if (!confirmed) {
            return;
        }

        const tx =
            await contract.methods
                .acceptAgreement(
                    Number(agreementId)
                )
                .send({
                    from:
                        currentAccount
                });

        const now =
            Math.floor(
                Date.now() / 1000
            );

        await supabaseClient
            .from("agreements")
            .update({

                status:
                    "In Progress",

                carrier_address:
                    currentAccount.toLowerCase(),

                accepted_at:
                    now

            })
            .eq(
                "agreement_id",
                Number(agreementId)
            );

        await supabaseClient
            .from("transactions")
            .insert([
                {

                    transaction_hash:
                        tx.transactionHash,

                    agreement_id:
                        Number(agreementId),

                    event_type:
                        "AgreementAccepted",

                    actor_address:
                        currentAccount.toLowerCase(),

                    details:
                    {
                        status:
                            "In Progress",

                        description:
                            "Carrier accepted the logistics agreement."
                    }
                }
            ]);

        alert(
            "Agreement accepted successfully!\n\n" +
            "Status: In Progress"
        );

        window.location.reload();

    } catch (error) {

        console.error(
            "Acceptance failed:",
            error
        );

        let message =
            error?.message ||
            String(error);

        if (
            error?.code ===
            4001
        ) {

            message =
                "Transaction was rejected in MetaMask.";
        }

        alert(
            "Failed to accept agreement:\n\n" +
            message
        );
    }
}


// =====================================================
// CANCEL AGREEMENT
// =====================================================

async function cancelAgreement() {

    if (
        agreementData.status !==
        "Created"
    ) {

        alert(
            "Only a Created agreement can be cancelled."
        );

        return;
    }

    const role =
        String(
            localStorage.getItem(
                "role"
            ) ||
            ""
        ).toLowerCase();

    if (
        role !== "1" &&
        role !== "shipper"
    ) {

        alert(
            "Only the Shipper can cancel the agreement."
        );

        return;
    }

    // -------------------------------------------------
    // If expired, expiry should be used instead
    // -------------------------------------------------

    if (
        isAgreementExpired()
    ) {

        await processAgreementExpiry();

        alert(
            "This agreement has expired. It cannot be cancelled. The expiry refund process has been initiated."
        );

        return;
    }

    if (
        !confirm(
            "Cancel this agreement?\n\n" +
            "The complete remaining escrow will be refunded to the Shipper."
        )
    ) {

        return;
    }

    try {

        if (
            typeof window.ethereum ===
            "undefined"
        ) {

            throw new Error(
                "MetaMask is required."
            );
        }

        const accounts =
            await window.ethereum.request({
                method:
                    "eth_requestAccounts"
            });

        const account =
            accounts[0];

        const shipper =
            (
                agreementData.blockchain_shipper ||
                agreementData.shipper_address ||
                ""
            ).toLowerCase();

        if (
            account.toLowerCase() !==
            shipper
        ) {

            throw new Error(
                "Only the Shipper can cancel this agreement."
            );
        }

        const web3 =
            new Web3(
                window.ethereum
            );

        const contract =
            new web3.eth.Contract(
                CONTRACT_ABI,
                CONTRACT_ADDRESS
            );

        const button =
            document.getElementById(
                "cancel-btn"
            );

        if (button) {

            button.disabled =
                true;

            button.innerHTML =
                '<i class="fa-solid fa-spinner fa-spin"></i> Cancelling & Refunding...';
        }

        const tx =
            await contract.methods
                .cancelAgreement(
                    Number(agreementId)
                )
                .send({
                    from:
                        account
                });

        const refund =
            Number(
                agreementData.escrow_remaining ||
                agreementData.escrow_amount ||
                0
            );

        await supabaseClient
            .from("agreements")
            .update({

                status:
                    "Cancelled",

                cancelled_at:
                    Math.floor(
                        Date.now() / 1000
                    ),

                refunded_amount:
                    refund,

                escrow_released:
                    refund,

                escrow_remaining:
                    0

            })
            .eq(
                "agreement_id",
                Number(agreementId)
            );

        await saveTransaction(
            tx.transactionHash,
            "AgreementCancelled",
            account,
            {

                status:
                    "Cancelled",

                escrow_refunded:
                    refund,

                description:
                    "Agreement cancelled and escrow refunded to shipper."
            }
        );

        alert(
            "Agreement cancelled successfully.\n\n" +
            "The escrow has been refunded to the Shipper."
        );

        window.location.reload();

    } catch (error) {

        console.error(
            "Cancellation failed:",
            error
        );

        alert(
            "Cancellation failed:\n\n" +
            (
                error?.code === 4001
                    ? "Transaction was rejected in MetaMask."
                    : error?.message ||
                    String(error)
            )
        );

        const button =
            document.getElementById(
                "cancel-btn"
            );

        if (button) {

            button.disabled =
                false;

            button.innerHTML =
                '<i class="fa-solid fa-xmark"></i> Cancel Agreement';
        }
    }
}


// =====================================================
// SAVE TRANSACTION
// =====================================================

async function saveTransaction(
    hash,
    eventType,
    actor,
    details
) {

    const {
        error
    } =
        await supabaseClient
            .from("transactions")
            .insert([
                {

                    transaction_hash:
                        hash,

                    agreement_id:
                        Number(
                            agreementId
                        ),

                    event_type:
                        eventType,

                    actor_address:
                        actor.toLowerCase(),

                    details:
                        details
                }
            ]);

    if (error) {

        console.warn(
            "Transaction save failed:",
            error
        );
    }
}


// =====================================================
// HELPERS
// =====================================================

function findMilestoneActionButton(
    text
) {

    return Array
        .from(
            document.querySelectorAll(
                "#milestones-container button"
            )
        )
        .find(
            button =>
                button.innerText
                    .includes(text)
        );
}


function getCarrierAddressRaw() {

    return (
        agreementData.blockchain_carrier ||
        agreementData.carrier_address ||
        ""
    );
}


function getCarrierAddress() {

    const carrier =
        getCarrierAddressRaw();

    if (
        !carrier ||
        isZeroAddress(
            carrier
        )
    ) {

        return "Unassigned";
    }

    return shortenAddress(
        carrier
    );
}


function isZeroAddress(
    address
) {

    return (
        String(address)
            .toLowerCase() ===
        "0x0000000000000000000000000000000000000000"
    );
}


function normalizeBool(
    value
) {

    return (
        value === true ||
        value === "true" ||
        value === 1 ||
        value === "1"
    );
}


function getBlockchainEth(
    weiValue,
    fallbackEth
) {

    if (
        weiValue !==
        undefined &&
        weiValue !==
        null
    ) {

        try {

            return Number(
                Web3.utils.fromWei(
                    weiValue.toString(),
                    "ether"
                )
            );

        } catch (error) {

            console.warn(
                "Wei conversion failed:",
                error
            );
        }
    }

    return Number(
        fallbackEth ||
        0
    );
}


function setText(
    id,
    value
) {

    const element =
        document.getElementById(
            id
        );

    if (element) {

        element.innerText =
            value;
    }
}


function formatDate(
    timestamp
) {

    if (!timestamp) {
        return "-";
    }

    return new Date(
        Number(timestamp) *
        1000
    ).toLocaleDateString(
        "en-US",
        {
            year:
                "numeric",

            month:
                "long",

            day:
                "numeric"
        }
    );
}


// =====================================================
// STATUS CLASS
// =====================================================

function getStatusClass(
    status
) {

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
    window.location.href = `milestoneSubmission.html?agreementId=${Number(agreementId)}&milestoneIndex=${Number(milestoneIndex)}&mode=${encodeURIComponent(mode)}`;
}


// =====================================================
// COUNTDOWN
// =====================================================

function updateCountdown(
    deadline
) {

    const element =
        document.getElementById(
            "expiry-countdown"
        );

    if (!element) {
        return;
    }

    function update() {

        const difference =
            Number(deadline) -
            Math.floor(
                Date.now() /
                1000
            );

        if (
            difference <=
            0
        ) {

            element.innerText =
                "Expired";

            element.classList.add(
                "expired"
            );

            return;
        }

        const days =
            Math.floor(
                difference /
                86400
            );

        const hours =
            Math.floor(
                (difference %
                    86400) /
                3600
            );

        const minutes =
            Math.floor(
                (difference %
                    3600) /
                60
            );

        element.innerText =
            `${days}d ${hours}h ${minutes}m`;
    }

    update();

    setInterval(
        update,
        60000
    );
}


// =====================================================
// NETWORK
// =====================================================

async function detectNetwork() {

    try {

        if (
            typeof window.ethereum ===
            "undefined"
        ) {

            return;
        }

        const web3 =
            new Web3(
                window.ethereum
            );

        const chainId =
            Number(
                await web3.eth.getChainId()
            );

        setText(
            "network-name",
            (
                chainId === 1337 ||
                chainId === 5777
            )
                ? "Ganache"
                : `Chain ${chainId}`
        );

    } catch (error) {

        console.warn(
            "Network detection failed:",
            error
        );
    }
}


// =====================================================
// SHORTEN ADDRESS
// =====================================================

function shortenAddress(
    address
) {

    if (!address) {
        return "-";
    }

    if (
        address.length <
        12
    ) {

        return address;
    }

    return (
        address.substring(
            0,
            6
        ) +
        "..." +
        address.substring(
            address.length -
            4
        )
    );
}


// =====================================================
// ESCAPE HTML
// =====================================================

function escapeHtml(
    value
) {

    if (
        value === null ||
        value === undefined
    ) {

        return "";
    }

    return String(value)
        .replace(
            /&/g,
            "&amp;"
        )
        .replace(
            /</g,
            "&lt;"
        )
        .replace(
            />/g,
            "&gt;"
        )
        .replace(
            /"/g,
            "&quot;"
        )
        .replace(
            /'/g,
            "&#039;"
        );
}


// =====================================================
// ERROR
// =====================================================

function showError(
    message
) {

    const loading =
        document.getElementById(
            "details-loading"
        );

    if (loading) {

        loading.style.display =
            "none";
    }

    const errorElement =
        document.getElementById(
            "details-error"
        );

    if (!errorElement) {
        return;
    }

    errorElement.style.display =
        "block";

    errorElement.innerHTML = `
        <i class="fa-solid fa-circle-exclamation"></i>
        ${escapeHtml(message)}

        <br><br>

        <a href="agreements.html">
            ← Back to Agreements
        </a>
    `;
}
