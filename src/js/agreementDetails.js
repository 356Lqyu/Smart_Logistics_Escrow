// =====================================================
// GLOBAL VARIABLES
// =====================================================

let agreementId = null;

let agreementData = null;

let milestoneData = [];

let transactionData = [];


// =====================================================
// PAGE LOAD
// =====================================================

document.addEventListener(
    "DOMContentLoaded",
    async () => {

        try {

            // -----------------------------------------
            // Get agreement ID
            // -----------------------------------------

            const params =
                new URLSearchParams(
                    window.location.search
                );


            agreementId =
                params.get("id");


            if (!agreementId) {

                showError(
                    "No agreement ID was provided."
                );

                return;
            }


            console.log(
                "Loading agreement:",
                agreementId
            );


            // -----------------------------------------
            // Load data
            // -----------------------------------------

            await loadAgreement();

            await loadMilestones();

            await loadTransactions();


            // -----------------------------------------
            // Render
            // -----------------------------------------

            renderAgreement();

            renderMilestones();

            renderTransactions();

            renderLifecycle();


            // -----------------------------------------
            // Buttons
            // -----------------------------------------

            setupActions();


            // -----------------------------------------
            // Show page
            // -----------------------------------------

            const loading =
                document.getElementById(
                    "details-loading"
                );


            const content =
                document.getElementById(
                    "agreement-content"
                );


            if (loading) {

                loading.style.display =
                    "none";
            }


            if (content) {

                content.style.display =
                    "block";
            }


        } catch (error) {

            console.error(
                "Failed to load agreement:",
                error
            );


            showError(
                "Failed to load agreement details: " +
                (error.message || error)
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
                agreementId
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


    console.log(
        "Agreement from Supabase:",
        agreementData
    );


    // =================================================
    // LOAD BLOCKCHAIN DATA
    // =================================================

    try {

        if (
            typeof window.ethereum !==
            "undefined"
        ) {

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
                        agreementId
                    )
                    .call();


            console.log(
                "Agreement from blockchain:",
                chainAgreement
            );


            agreementData.blockchain_escrow =
                chainAgreement.escrowAmount;


            agreementData.blockchain_shipper =
                chainAgreement.shipper;


            agreementData.blockchain_carrier =
                chainAgreement.carrier;


            agreementData.blockchain_status =
                Number(
                    chainAgreement.status
                );

        }

    } catch (error) {

        console.warn(
            "Could not load blockchain agreement:",
            error
        );

    }

}


// =====================================================
// LOAD MILESTONES
// =====================================================

async function loadMilestones() {

    try {

        const numericAgreementId =
            Number(agreementId);


        console.log(
            "Loading milestones for agreement:",
            numericAgreementId
        );


        if (
            !numericAgreementId ||
            numericAgreementId <= 0
        ) {

            console.warn(
                "Invalid agreement ID:",
                agreementId
            );


            milestoneData =
                [];


            return;
        }


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
                    verified
                `)
                .eq(
                    "agreement_id",
                    numericAgreementId
                )
                .order(
                    "milestone_index",
                    {
                        ascending: true
                    }
                );


        if (error) {

            console.error(
                "Failed to load milestones:",
                error
            );


            throw error;
        }


        milestoneData =
            data || [];


        console.log(
            "Milestones returned from Supabase:",
            milestoneData
        );


        console.log(
            "Number of milestones:",
            milestoneData.length
        );


    } catch (error) {

        console.error(
            "loadMilestones() failed:",
            error
        );


        milestoneData =
            [];

    }

}


// =====================================================
// LOAD TRANSACTIONS
// =====================================================

async function loadTransactions() {

    const {
        data,
        error
    } =
        await supabaseClient
            .from("transactions")
            .select(`
                id,
                transaction_hash,
                agreement_id,
                event_type,
                actor_address,
                details,
                created_at,
                users (
                    name,
                    role
                )
            `)
            .eq(
                "agreement_id",
                agreementId
            )
            .order(
                "created_at",
                {
                    ascending: false
                }
            );


    if (error) {

        console.warn(
            "Transaction query failed:",
            error
        );


        transactionData =
            [];


        return;
    }


    transactionData =
        data || [];


    console.log(
        "Transactions:",
        transactionData
    );

}


// =====================================================
// RENDER AGREEMENT
// =====================================================

function renderAgreement() {

    // -----------------------------------------------
    // Reference
    // -----------------------------------------------

    const reference =
        agreementData.reference_no;


    const referenceElement =
        document.getElementById(
            "agreement-reference"
        );


    if (referenceElement) {

        referenceElement.innerText =
            reference || "-";
    }


    // -----------------------------------------------
    // Shipment
    // -----------------------------------------------

    const shipmentElement =
        document.getElementById(
            "agreement-shipment"
        );


    if (shipmentElement) {

        shipmentElement.innerText =
            agreementData.shipment_details ||
            "Shipment details unavailable";
    }


    // -----------------------------------------------
    // STATUS
    // -----------------------------------------------

    const status =
        agreementData.status ||
        "Created";


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
            getStatusClass(status);
    }


    // -----------------------------------------------
    // PRIORITY
    // -----------------------------------------------

    const priority =
        agreementData.priority ||
        "Normal";


    const priorityElement =
        document.getElementById(
            "agreement-priority"
        );


    if (priorityElement) {

        priorityElement.innerText =
            priority.toUpperCase();


        priorityElement.className =
            "priority-badge " +
            getPriorityClass(priority);
    }


    // -----------------------------------------------
    // ADDRESSES
    // -----------------------------------------------

    const shipper =
        agreementData.blockchain_shipper ||
        agreementData.shipper_address;


    const carrier =
        agreementData.blockchain_carrier ||
        agreementData.carrier_address;


    const shipperElement =
        document.getElementById(
            "shipper-address"
        );


    if (shipperElement) {

        shipperElement.innerText =
            shortenAddress(shipper);


        shipperElement.title =
            shipper || "";
    }


    const carrierElement =
        document.getElementById(
            "carrier-address"
        );


    if (
        carrier &&
        carrier !==
        "0x0000000000000000000000000000000000000000"
    ) {

        if (carrierElement) {

            carrierElement.innerText =
                shortenAddress(carrier);

            carrierElement.title =
                carrier;
        }

    } else {

        if (carrierElement) {

            carrierElement.innerText =
                "Unassigned";

            carrierElement.title =
                "";
        }
    }


    // -----------------------------------------------
    // ESCROW
    // -----------------------------------------------

    let escrow =
        Number(
            agreementData.escrow_amount || 0
        );


    if (
        agreementData.blockchain_escrow !==
        undefined &&
        agreementData.blockchain_escrow !==
        null
    ) {

        try {

            escrow =
                Number(
                    Web3.utils.fromWei(
                        agreementData
                            .blockchain_escrow
                            .toString(),
                        "ether"
                    )
                );

        } catch (error) {

            console.warn(
                "Escrow conversion failed:",
                error
            );
        }
    }


    const escrowElement =
        document.getElementById(
            "escrow-amount"
        );


    if (escrowElement) {

        escrowElement.innerText =
            `${escrow.toFixed(3)} ETH`;
    }


    // -----------------------------------------------
    // DEADLINE
    // -----------------------------------------------

    const deadline =
        Number(
            agreementData.deadline
        );


    const deadlineElement =
        document.getElementById(
            "agreement-deadline"
        );


    if (deadlineElement) {

        deadlineElement.innerText =
            formatDate(deadline);
    }


    if (deadline) {

        updateCountdown(
            deadline
        );
    }


    // -----------------------------------------------
    // NETWORK
    // -----------------------------------------------

    detectNetwork();


    // -----------------------------------------------
    // EXPLORER
    // -----------------------------------------------

    setupExplorerLink();


    // =====================================================
    // SHIPMENT & AGREEMENT DETAILS
    // =====================================================

    // Shipment Details
    const detailShipment =
        document.getElementById("detail-shipment");

    if (detailShipment) {
        detailShipment.innerText =
            agreementData.shipment_details ||
            "No shipment details provided.";
    }


    // Payload Value
    const detailPayload =
        document.getElementById("detail-payload-value");

    if (detailPayload) {
        const payload =
            Number(agreementData.payload_value || 0);

        detailPayload.innerText =
            `$${payload.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            })}`;
    }


    // Origin
    const detailOrigin =
        document.getElementById("detail-origin");

    if (detailOrigin) {
        detailOrigin.innerText =
            agreementData.origin ||
            "-";
    }


    // Destination
    const detailDestination =
        document.getElementById("detail-destination");

    if (detailDestination) {
        detailDestination.innerText =
            agreementData.destination ||
            "-";
    }


    // Escrow Amount
    const detailEscrowAmount =
        document.getElementById("detail-escrow-amount");

    if (detailEscrowAmount) {
        const escrow =
            Number(agreementData.escrow_amount || 0);

        detailEscrowAmount.innerText =
            `${escrow.toFixed(3)} ETH`;
    }


    // Escrow Released
    const detailEscrowReleased =
        document.getElementById("detail-escrow-released");

    if (detailEscrowReleased) {
        const released =
            Number(agreementData.escrow_released || 0);

        detailEscrowReleased.innerText =
            `${released.toFixed(3)} ETH`;
    }


    // Escrow Remaining
    const detailEscrowRemaining =
        document.getElementById("detail-escrow-remaining");

    if (detailEscrowRemaining) {
        const remaining =
            Number(agreementData.escrow_remaining || 0);

        detailEscrowRemaining.innerText =
            `${remaining.toFixed(3)} ETH`;
    }


    // Priority
    const detailPriority =
        document.getElementById("detail-priority");

    if (detailPriority) {
        detailPriority.innerText =
            agreementData.priority ||
            "Normal";
    }

}


// =====================================================
// STATUS CLASS
// =====================================================

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


// =====================================================
// PRIORITY CLASS
// =====================================================

function getPriorityClass(priority) {

    switch (priority) {

        case "Urgent":
            return "priority-urgent";

        case "Express":
            return "priority-express";

        default:
            return "priority-normal";
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


    // -------------------------------------------------
    // SAFETY CHECK
    // -------------------------------------------------

    if (!container) {

        console.warn(
            "Milestones container not found."
        );

        return;
    }


    // -------------------------------------------------
    // CANCELLED AGREEMENT
    // -------------------------------------------------

    if (
        agreementData &&
        agreementData.status === "Cancelled"
    ) {

        container.innerHTML = `
        <div class="milestone-cancelled">
                <p>
                    This agreement was cancelled before shipment
                    progress began. The escrow has been refunded
                    to the shipper.
                </p>

        </div>
    `;

        const progressText =
            document.getElementById(
                "overall-progress"
            );

        const progressBar =
            document.getElementById(
                "overall-progress-bar"
            );


        if (progressBar) {
            progressBar.style.width = "0%";
        }

        return;
    }

    // -------------------------------------------------
    // CLEAR
    // -------------------------------------------------

    container.innerHTML =
        "";


    // -------------------------------------------------
    // NO DATA
    // -------------------------------------------------

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


    // -------------------------------------------------
    // CHECK IF AGREEMENT IS IN PROGRESS 
    // -------------------------------------------------
    const isAccepted =
        agreementData &&
        (agreementData.status === "In Progress" || agreementData.status === "Completed");


    // -------------------------------------------------
    // FIND FIRST INCOMPLETE MILESTONE (Only if accepted)
    // -------------------------------------------------

    let firstIncompleteIndex =
        -1;


    if (isAccepted) {
        for (
            let i = 0;
            i < milestoneData.length;
            i++
        ) {
            const milestone = milestoneData[i];

            const completed =
                milestone.completed === true ||
                milestone.completed === "true" ||
                milestone.completed === 1;

            const verified =
                milestone.verified === true ||
                milestone.verified === "true" ||
                milestone.verified === 1;

            if (!(completed && verified)) {
                firstIncompleteIndex = i;
                break;
            }
        }
    }


    // -------------------------------------------------
    // RENDER
    // -------------------------------------------------

    milestoneData.forEach(
        (
            milestone,
            index
        ) => {

            // =========================================
            // NORMALIZE
            // =========================================

            const completed =
                milestone.completed === true ||
                milestone.completed === "true" ||
                milestone.completed === 1;


            const verified =
                milestone.verified === true ||
                milestone.verified === "true" ||
                milestone.verified === 1;


            const percentage =
                Number(
                    milestone.percentage || 0
                );


            const checkpoint =
                milestone.checkpoint ||
                milestone.name ||
                milestone.title ||
                `Milestone ${index + 1}`;


            // =========================================
            // DETERMINE STATE
            // =========================================

            let state =
                "pending";


            let stateText =
                "Pending";


            // -----------------------------------------
            // COMPLETED
            // -----------------------------------------

            if (
                completed &&
                verified
            ) {

                state =
                    "completed";


                stateText =
                    "Completed";
            }


            // -----------------------------------------
            // COMPLETED BUT WAITING VERIFICATION
            // -----------------------------------------

            else if (
                completed &&
                !verified
            ) {

                state =
                    "active";


                stateText =
                    "Awaiting Verification";
            }


            // -----------------------------------------
            // CURRENT ACTIVE MILESTONE
            // -----------------------------------------

            else if (
                index ===
                firstIncompleteIndex
            ) {

                state =
                    "active";


                stateText =
                    "Active";
            }


            // -----------------------------------------
            // PENDING
            // -----------------------------------------

            else {

                state =
                    "pending";


                stateText =
                    "Pending";
            }


            // =========================================
            // ETH AMOUNT
            // =========================================

            const amount =
                calculateMilestoneAmount(
                    percentage
                );


            // =========================================
            // NUMBER / CHECK
            // =========================================

            let numberContent =
                index + 1;


            if (
                completed &&
                verified
            ) {

                numberContent = `
                    <i class="fa-solid fa-check"></i>
                `;
            }


            // =========================================
            // CREATE ROW
            // =========================================

            const item =
                document.createElement(
                    "div"
                );


            item.className =
                `milestone-item ${state}`;


            // =========================================
            // HTML
            // =========================================

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

                    </div>

                </div>


                <div class="milestone-status ${state}">

                    <span class="milestone-status-dot"></span>

                    <span>
                        ${stateText}
                    </span>

                </div>

            `;


            // =========================================
            // ADD
            // =========================================

            container.appendChild(
                item
            );

        }
    );


    // -------------------------------------------------
    // UPDATE PROGRESS
    // -------------------------------------------------

    updateOverallProgress();

}


// =====================================================
// CALCULATE MILESTONE ETH AMOUNT
// =====================================================

function calculateMilestoneAmount(
    percentage
) {

    let escrowWei =
        null;


    // -------------------------------------------------
    // FIRST: BLOCKCHAIN ESCROW
    // -------------------------------------------------

    if (
        agreementData &&
        agreementData.blockchain_escrow !==
        undefined &&
        agreementData.blockchain_escrow !==
        null
    ) {

        escrowWei =
            agreementData.blockchain_escrow;
    }


    // -------------------------------------------------
    // FALLBACK: SUPABASE ESCROW
    // -------------------------------------------------

    if (
        escrowWei === null ||
        escrowWei === undefined
    ) {

        escrowWei =
            agreementData
                ? agreementData.escrow_amount
                : 0;
    }


    // -------------------------------------------------
    // CONVERT TO ETH
    // -------------------------------------------------

    let escrowEth =
        0;


    try {

        if (
            typeof Web3 !==
            "undefined" &&
            Web3.utils &&
            escrowWei !==
            undefined &&
            escrowWei !==
            null
        ) {

            escrowEth =
                Number(
                    Web3.utils.fromWei(
                        escrowWei.toString(),
                        "ether"
                    )
                );

        } else {

            escrowEth =
                Number(
                    escrowWei || 0
                );

        }

    } catch (error) {

        console.warn(
            "Could not calculate milestone ETH:",
            error
        );


        escrowEth =
            Number(
                escrowWei || 0
            );

    }


    // -------------------------------------------------
    // CALCULATE
    // -------------------------------------------------

    const milestoneAmount =
        escrowEth *
        Number(percentage) /
        100;


    // -------------------------------------------------
    // RETURN
    // -------------------------------------------------

    return milestoneAmount.toFixed(3);

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


    if (
        !milestoneData ||
        milestoneData.length === 0
    ) {

        if (progressText) {

            progressText.innerText =
                "0%";
        }


        if (progressBar) {

            progressBar.style.width =
                "0%";
        }


        return;
    }


    let completedPercentage =
        0;


    milestoneData.forEach(
        milestone => {

            const completed =
                milestone.completed === true ||
                milestone.completed === "true" ||
                milestone.completed === 1;


            const verified =
                milestone.verified === true ||
                milestone.verified === "true" ||
                milestone.verified === 1;


            if (
                completed &&
                verified
            ) {

                completedPercentage +=
                    Number(
                        milestone.percentage
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

        console.warn(
            "Lifecycle container not found."
        );

        return;
    }


    // -------------------------------------------------
    // STATUS
    // -------------------------------------------------

    const status =
        agreementData &&
            agreementData.status
            ? agreementData.status
            : "Created";


    // -------------------------------------------------
    // CHECK WHETHER CARRIER IS ASSIGNED
    // -------------------------------------------------

    const zeroAddress =
        "0x0000000000000000000000000000000000000000";


    const carrier =
        agreementData &&
        (
            agreementData.blockchain_carrier ||
            agreementData.carrier_address
        );


    const hasCarrier =
        carrier &&
        carrier.toLowerCase() !==
        zeroAddress;


    // -------------------------------------------------
    // CHECK MILESTONE COMPLETION
    // -------------------------------------------------

    function milestoneCompleted(
        milestone
    ) {

        const completed =
            milestone.completed === true ||
            milestone.completed === "true" ||
            milestone.completed === 1;


        const verified =
            milestone.verified === true ||
            milestone.verified === "true" ||
            milestone.verified === 1;


        return (
            completed &&
            verified
        );
    }


    // =================================================
    // 1. CANCELLED
    // =================================================
    //
    // Created → Cancelled
    //
    // Cancellation happens before acceptance.
    // No milestones.
    // =================================================

    if (
        status === "Cancelled"
    ) {

        const stages = [

            {
                key: "Created",
                label: "Created",
                state: "completed"
            },

            {
                key: "Cancelled",
                label: "Cancelled",
                state: "cancelled"
            },

            {
                key: "Refunded",
                label: "Refunded",
                state: "refunded"
            }

        ];


        renderLifecycleStages(
            container,
            stages
        );


        return;
    }


    // =================================================
    // 2. EXPIRED
    // =================================================
    //
    // If carrier accepted:
    //
    // Created → Accepted → Expired → Refunded
    //
    // If carrier did not accept:
    //
    // Created → Expired → Refunded
    //
    // No normal milestones.
    // =================================================

    if (
        status === "Expired"
    ) {

        const stages = [

            {
                key: "Created",
                label: "Created",
                state: "completed"
            }

        ];


        // ---------------------------------------------
        // Carrier accepted
        // ---------------------------------------------

        if (hasCarrier) {

            stages.push({

                key: "Accepted",
                label: "Accepted",
                state: "completed"

            });

        }


        // ---------------------------------------------
        // Expired
        // ---------------------------------------------

        stages.push({

            key: "Expired",
            label: "Expired",
            state: "expired"

        });


        // ---------------------------------------------
        // Refund
        //
        // expireAgreement() refunds the escrow.
        // ---------------------------------------------

        stages.push({

            key: "Refunded",
            label: "Refunded",
            state: "refunded"

        });


        renderLifecycleStages(
            container,
            stages
        );


        return;
    }


    // =================================================
    // 3. REFUNDED
    // =================================================
    //
    // This is included for safety in case your
    // Supabase record eventually uses "Refunded"
    // as its final status.
    //
    // Created → Refunded
    //
    // No milestones.
    // =================================================

    if (
        status === "Refunded"
    ) {

        const stages = [

            {
                key: "Created",
                label: "Created",
                state: "completed"
            },

            {
                key: "Refunded",
                label: "Refunded",
                state: "refunded"
            }

        ];


        renderLifecycleStages(
            container,
            stages
        );


        return;
    }


    // =================================================
    // 4. NORMAL AGREEMENT
    // =================================================
    //
    // Created
    // Accepted
    // Milestones
    // Completed
    //
    // Milestones are dynamically loaded from Supabase.
    // =================================================

    const stages = [

        {
            key: "Created",
            label: "Created"
        },

        {
            key: "Accepted",
            label: "Accepted"
        }

    ];


    // -------------------------------------------------
    // Add actual milestones
    // -------------------------------------------------

    if (
        milestoneData &&
        milestoneData.length > 0
    ) {

        milestoneData.forEach(
            (
                milestone,
                index
            ) => {

                stages.push({

                    key:
                        `Milestone-${index}`,

                    label:
                        milestone.checkpoint ||
                        `Milestone ${index + 1}`,

                    milestone:
                        true,

                    completed:
                        milestoneCompleted(
                            milestone
                        )

                });

            }
        );

    }


    // -------------------------------------------------
    // Completed
    // -------------------------------------------------

    stages.push({

        key: "Completed",

        label: "Completed"

    });


    // =================================================
    // DETERMINE CURRENT NORMAL STAGE
    // =================================================

    let currentIndex = 0;


    // -------------------------------------------------
    // CREATED
    // -------------------------------------------------

    if (
        status === "Created"
    ) {

        currentIndex =
            0;

    }


    // -------------------------------------------------
    // IN PROGRESS
    // -------------------------------------------------

    else if (
        status === "In Progress"
    ) {

        // Created = 0
        // Accepted = 1
        // Milestone 1 = 2
        // Milestone 2 = 3
        // ...

        let completedMilestones =
            0;


        if (
            milestoneData &&
            milestoneData.length > 0
        ) {

            milestoneData.forEach(
                milestone => {

                    if (
                        milestoneCompleted(
                            milestone
                        )
                    ) {

                        completedMilestones++;

                    }

                }
            );

        }


        currentIndex =
            1 +
            completedMilestones;


        // Never exceed last stage
        currentIndex =
            Math.min(
                currentIndex,
                stages.length - 1
            );

    }


    // -------------------------------------------------
    // COMPLETED
    // -------------------------------------------------

    else if (
        status === "Completed"
    ) {

        currentIndex =
            stages.length - 1;

    }


    // =================================================
    // APPLY STATE
    // =================================================

    stages.forEach(
        (
            stage,
            index
        ) => {

            if (
                status === "Completed"
            ) {

                stage.state =
                    "completed";

            }

            else if (
                index <
                currentIndex
            ) {

                stage.state =
                    "completed";

            }

            else if (
                index ===
                currentIndex
            ) {

                stage.state =
                    "active";

            }

            else {

                stage.state =
                    "pending";

            }

        }
    );


    // =================================================
    // RENDER
    // =================================================

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
                "";


            // -------------------------------------------------
            // STATE CLASS
            // -------------------------------------------------

            if (
                stage.state ===
                "completed"
            ) {

                className =
                    "completed";

            }

            else if (
                stage.state ===
                "active"
            ) {

                className =
                    "active";

            }

            else if (
                stage.state ===
                "cancelled"
            ) {

                className =
                    "cancelled";

            }

            else if (
                stage.state ===
                "expired"
            ) {

                className =
                    "expired";

            }

            else if (
                stage.state ===
                "refunded"
            ) {

                className =
                    "refunded";

            }


            // -------------------------------------------------
            // CIRCLE CONTENT
            // -------------------------------------------------

            let circleContent =
                index + 1;


            if (
                stage.state ===
                "completed"
            ) {

                circleContent =
                    '<i class="fa-solid fa-check"></i>';

            }

            else if (
                stage.state ===
                "cancelled"
            ) {

                circleContent =
                    '<i class="fa-solid fa-xmark"></i>';

            }

            else if (
                stage.state ===
                "expired"
            ) {

                circleContent =
                    '<i class="fa-solid fa-clock"></i>';

            }

            else if (
                stage.state ===
                "refunded"
            ) {

                circleContent =
                    '<i class="fa-solid fa-rotate-left"></i>';

            }


            // -------------------------------------------------
            // HTML
            // -------------------------------------------------

            html += `

                <div class="timeline-stage ${className}">

                    <div class="timeline-circle">

                        ${circleContent}

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
// ACTION BUTTONS
// =====================================================

function setupActions() {

    const cancelButton =
        document.getElementById(
            "cancel-btn"
        );


    const notesButton =
        document.getElementById(
            "notes-btn"
        );


    // =================================================
    // CANCEL
    // =================================================
    //
    // ONLY Created can be cancelled.
    //
    // Created means:
    // - Agreement has been created
    // - Escrow has already been funded
    //
    // In Progress CANNOT be cancelled.
    //
    // =================================================

    if (
        cancelButton
    ) {

        if (
            agreementData.status ===
            "Created"
        ) {

            cancelButton.style.display =
                "inline-flex";

            cancelButton.disabled =
                false;

        } else {

            cancelButton.style.display =
                "none";

        }


        cancelButton.onclick =
            cancelAgreement;
    }


    // =================================================
    // NOTES
    // =================================================

    if (
        notesButton
    ) {

        notesButton.onclick =
            () => {

                const section =
                    document.getElementById(
                        "notes-section"
                    );


                if (!section) {

                    return;
                }


                if (
                    section.style.display ===
                    "none"
                ) {

                    section.style.display =
                        "block";


                    notesButton.innerHTML = `
                        <i class="fa-regular fa-file-lines"></i>
                        Hide Notes
                    `;

                } else {

                    section.style.display =
                        "none";


                    notesButton.innerHTML = `
                        <i class="fa-regular fa-file-lines"></i>
                        View Notes
                    `;
                }

            };
    }

}


// =====================================================
// CANCEL AGREEMENT
// =====================================================

async function cancelAgreement() {

    // -------------------------------------------------
    // CHECK LOCAL STATUS FIRST
    // -------------------------------------------------

    if (
        agreementData.status !==
        "Created"
    ) {

        alert(
            "Only a Created agreement can be cancelled.\n\n" +
            "In Progress agreements cannot be cancelled."
        );

        return;
    }


    // -------------------------------------------------
    // Confirm
    // -------------------------------------------------

    const confirmed =
        confirm(
            "Are you sure you want to cancel this agreement?\n\n" +
            "The escrow ETH will be refunded to the shipper."
        );


    if (!confirmed) {

        return;
    }


    try {

        // -------------------------------------------------
        // Check MetaMask
        // -------------------------------------------------

        if (
            typeof window.ethereum ===
            "undefined"
        ) {

            throw new Error(
                "MetaMask is required."
            );
        }


        // -------------------------------------------------
        // Get account
        // -------------------------------------------------

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


        const account =
            accounts[0];


        // -------------------------------------------------
        // Web3
        // -------------------------------------------------

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
        // Make sure current user is shipper
        // -------------------------------------------------

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
                "Only the shipper can cancel this agreement."
            );
        }


        // -------------------------------------------------
        // Make sure status is Created
        // -------------------------------------------------

        if (
            agreementData.status !==
            "Created"
        ) {

            throw new Error(
                "Only a Created agreement can be cancelled. " +
                "In Progress agreements cannot be cancelled."
            );
        }


        // -------------------------------------------------
        // Button
        // -------------------------------------------------

        const button =
            document.getElementById(
                "cancel-btn"
            );


        if (button) {

            button.disabled =
                true;


            button.innerHTML = `
                <i class="fa-solid fa-spinner fa-spin"></i>
                Cancelling & Refunding...
            `;
        }


        // -------------------------------------------------
        // CANCEL + REFUND
        //
        // The smart contract performs the refund.
        //
        // No ETH is sent from frontend.
        //
        // -------------------------------------------------

        const tx =
            await contract.methods
                .cancelAgreement(
                    agreementId
                )
                .send({

                    from:
                        account

                });


        console.log(
            "Agreement cancelled:",
            tx
        );


        // -------------------------------------------------
        // Update Supabase
        // -------------------------------------------------

        const now =
            Math.floor(
                Date.now() / 1000
            );


        const escrowAmount =
            Number(
                agreementData.escrow_amount ||
                0
            );


        const {
            error:
            updateError
        } =
            await supabaseClient
                .from("agreements")
                .update({

                    status:
                        "Cancelled",

                    cancelled_at:
                        now,

                    refunded_amount:
                        escrowAmount,

                    escrow_remaining:
                        0

                })
                .eq(
                    "agreement_id",
                    agreementId
                );


        if (updateError) {

            console.error(
                "Supabase update failed:",
                updateError
            );

        }


        // -------------------------------------------------
        // Save transaction
        // -------------------------------------------------

        await saveTransaction(
            tx.transactionHash,
            "AgreementCancelled",
            account,
            {
                description:
                    "Agreement cancelled and escrow refunded to shipper.",

                escrow_refunded:
                    escrowAmount,

                status:
                    "Cancelled"
            }
        );


        // -------------------------------------------------
        // Success
        // -------------------------------------------------

        alert(
            "Agreement cancelled successfully.\n\n" +
            "The escrow has been refunded to the shipper."
        );


        window.location.reload();


    } catch (error) {

        console.error(
            "Cancellation failed:",
            error
        );


        let message =
            error.message ||
            String(error);


        if (
            error.code === 4001
        ) {

            message =
                "Transaction was rejected in MetaMask.";
        }


        alert(
            "Cancellation failed:\n\n" +
            message
        );


        // Restore button

        const button =
            document.getElementById(
                "cancel-btn"
            );


        if (button) {

            button.disabled =
                false;


            button.innerHTML = `
                <i class="fa-solid fa-xmark"></i>
                Cancel Agreement
            `;
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
            .insert([{

                transaction_hash:
                    hash,

                agreement_id:
                    Number(agreementId),

                event_type:
                    eventType,

                actor_address:
                    actor.toLowerCase(),

                details:
                    details

            }]);

    if (error) {

        console.error(
            "Transaction save failed:",
            error
        );

    }

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


        const chainElement =
            document.getElementById(
                "chain-id"
            );


        const networkElement =
            document.getElementById(
                "network-name"
            );


        if (chainElement) {

            chainElement.innerText =
                chainId;
        }


        if (networkElement) {

            if (
                chainId === 1337 ||
                chainId === 5777
            ) {

                networkElement.innerText =
                    "Ganache";

            } else if (
                chainId === 1
            ) {

                networkElement.innerText =
                    "Ethereum Mainnet";

            } else {

                networkElement.innerText =
                    `Chain ${chainId}`;
            }
        }


        // ---------------------------------------------
        // Gas
        // ---------------------------------------------

        const gasPrice =
            await web3.eth.getGasPrice();


        const gasGwei =
            web3.utils.fromWei(
                gasPrice,
                "gwei"
            );


        const gasElement =
            document.getElementById(
                "gas-price"
            );


        if (gasElement) {

            gasElement.innerText =
                `${Number(
                    gasGwei
                ).toFixed(1)} Gwei`;
        }


    } catch (error) {

        console.warn(
            "Network information unavailable:",
            error
        );

    }

}


// =====================================================
// EXPLORER
// =====================================================

function setupExplorerLink() {

    const link =
        document.getElementById(
            "etherscan-link"
        );


    if (!link) {

        return;
    }


    link.href =
        `https://etherscan.io/address/${CONTRACT_ADDRESS}`;

}


// =====================================================
// EXPLORER TRANSACTION URL
// =====================================================

function getExplorerTxUrl(
    hash
) {

    return (
        `https://etherscan.io/tx/${hash}`
    );

}


// =====================================================
// TRANSACTIONS
// =====================================================

function renderTransactions() {

    const body =
        document.getElementById(
            "transactions-body"
        );


    if (!body) {

        return;
    }


    body.innerHTML =
        "";


    if (
        !transactionData ||
        transactionData.length === 0
    ) {

        body.innerHTML = `
            <tr>
                <td colspan="5">
                    No transactions found.
                </td>
            </tr>
        `;


        return;
    }


    transactionData.forEach(
        transaction => {

            const row =
                document.createElement(
                    "tr"
                );


            const actor =
                transaction.actor_address;


            const hash =
                transaction.transaction_hash;


            const user =
                transaction.users;


            const userName =
                user &&
                    user.name
                    ? user.name
                    : "";


            row.innerHTML = `

                <td>

                    <span class="event-badge">

                        ${escapeHtml(
                transaction.event_type
            )}

                    </span>

                </td>


                <td>

                    <div class="actor-cell">

                        <strong>

                            ${userName ||
                shortenAddress(
                    actor
                )
                }

                        </strong>

                        <small>

                            ${shortenAddress(
                    actor
                )}

                        </small>

                    </div>

                </td>


                <td>

                    <a
                        href="${getExplorerTxUrl(hash)}"
                        target="_blank"
                        class="transaction-link"
                    >

                        ${shortenHash(hash)}

                        <i class="fa-solid fa-arrow-up-right-from-square"></i>

                    </a>

                </td>


                <td>

                   ${escapeHtml(
                    formatTransactionDetails(transaction)
                )}
                )}

                </td>


                <td>

                    ${formatTimestamp(
                    transaction.created_at
                )}

                </td>

            `;


            body.appendChild(
                row
            );

        }
    );

}


// =====================================================
// FORMAT TRANSACTION DETAILS
// =====================================================

function formatTransactionDetails(transaction) {

    const eventType =
        transaction.event_type;

    let details = {};

    try {

        details = JSON.parse(
            transaction.details || "{}"
        );

    } catch (error) {

        return transaction.details || "-";
    }


    // -------------------------------------------------
    // AGREEMENT CREATED + ESCROW FUNDED
    // -------------------------------------------------

    if (
        eventType === "AgreementCreated"
    ) {

        const escrow =
            details.escrow || {};

        return (
            "Agreement " +
            (details.reference_no || "-") +
            " created and escrow funded with " +
            (escrow.amount || "0") +
            " ETH."
        );
    }


    // -------------------------------------------------
    // ESCROW FUNDED
    // -------------------------------------------------

    if (
        eventType === "EscrowFunded"
    ) {

        return (
            "Escrow funded with " +
            (details.amount || "0") +
            " ETH."
        );
    }


    // -------------------------------------------------
    // AGREEMENT ACCEPTED
    // -------------------------------------------------

    if (
        eventType === "AgreementAccepted"
    ) {

        return (
            "Carrier accepted the logistics agreement."
        );
    }


    // -------------------------------------------------
    // MILESTONE COMPLETED
    // -------------------------------------------------

    if (
        eventType === "MilestoneCompleted"
    ) {

        return (
            (details.checkpoint || "Milestone") +
            " completed."
        );
    }


    // -------------------------------------------------
    // MILESTONE VERIFIED
    // -------------------------------------------------

    if (
        eventType === "MilestoneVerified"
    ) {

        return (
            (details.checkpoint || "Milestone") +
            " verified."
        );
    }


    // -------------------------------------------------
    // MILESTONE PAYOUT
    // -------------------------------------------------

    if (
        eventType === "MilestonePayout"
    ) {

        return (
            (details.amount || "0") +
            " ETH released for " +
            (details.checkpoint || "milestone") +
            ". Remaining escrow: " +
            (details.escrow_remaining || "0") +
            " ETH."
        );
    }


    // -------------------------------------------------
    // AGREEMENT COMPLETED
    // -------------------------------------------------

    if (
        eventType === "AgreementCompleted"
    ) {

        return (
            "Agreement completed successfully."
        );
    }


    // -------------------------------------------------
    // AGREEMENT CANCELLED
    // -------------------------------------------------

    if (
        eventType === "AgreementCancelled"
    ) {

        return (
            "Agreement cancelled."
        );
    }


    // -------------------------------------------------
    // ESCROW REFUNDED
    // -------------------------------------------------

    if (
        eventType === "EscrowRefunded"
    ) {

        return (
            (details.amount || "0") +
            " ETH refunded to the shipper."
        );
    }


    // -------------------------------------------------
    // AGREEMENT EXPIRED
    // -------------------------------------------------

    if (
        eventType === "AgreementExpired"
    ) {

        return (
            "Agreement expired."
        );
    }


    // -------------------------------------------------
    // FALLBACK
    // -------------------------------------------------

    return (
        details.message ||
        details.description ||
        transaction.details ||
        "-"
    );
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

        const now =
            Math.floor(
                Date.now() / 1000
            );


        const difference =
            Number(deadline) -
            now;


        if (
            difference <= 0
        ) {

            element.innerText =
                "Expired";


            element.style.color =
                "#ef4444";


            return;
        }


        const days =
            Math.floor(
                difference / 86400
            );


        const hours =
            Math.floor(
                (difference % 86400) /
                3600
            );


        const minutes =
            Math.floor(
                (difference % 3600) /
                60
            );


        element.innerText =
            `${days}d ${hours}h ${minutes}m`;


        element.style.color =
            "";
    }


    update();


    setInterval(
        update,
        60000
    );

}


// =====================================================
// DATE
// =====================================================

function formatDate(
    timestamp
) {

    if (!timestamp) {

        return "-";
    }


    return new Date(
        Number(timestamp) * 1000
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
// TIMESTAMP
// =====================================================

function formatTimestamp(
    timestamp
) {

    if (!timestamp) {

        return "-";
    }


    return new Date(
        timestamp
    ).toLocaleString();

}


// =====================================================
// ADDRESS
// =====================================================

function shortenAddress(
    address
) {

    if (!address) {

        return "-";
    }


    if (
        address.length < 12
    ) {

        return address;
    }


    return (
        address.substring(0, 6) +
        "..." +
        address.substring(
            address.length - 4
        )
    );

}


// =====================================================
// HASH
// =====================================================

function shortenHash(
    hash
) {

    if (!hash) {

        return "-";
    }


    if (
        hash.length < 20
    ) {

        return hash;
    }


    return (
        hash.substring(0, 10) +
        "..." +
        hash.substring(
            hash.length - 8
        )
    );

}


// =====================================================
// HTML ESCAPE
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