// =====================================================
// CREATE AGREEMENT PAGE
// =====================================================

document.addEventListener("DOMContentLoaded", () => {


    // -------------------------------------------------
    // Initialize milestone preview
    // -------------------------------------------------

    updateMilestones();
});


// =====================================================
// MILESTONE UI
// =====================================================

function updateMilestones() {

    const m1 =
        document.getElementById("m1_pct");

    const m2 =
        document.getElementById("m2_pct");

    const m3 =
        document.getElementById("m3_pct");


    const p1 =
        m1 ? parseInt(m1.value) || 0 : 0;

    const p2 =
        m2 ? parseInt(m2.value) || 0 : 0;

    const p3 =
        m3 ? parseInt(m3.value) || 0 : 0;


    const total =
        p1 + p2 + p3;


    // =================================================
    // Progress bars
    // =================================================

    const b1 =
        document.getElementById("m1_bar");

    const b2 =
        document.getElementById("m2_bar");

    const b3 =
        document.getElementById("m3_bar");


    if (b1) {
        b1.style.width =
            `${Math.min(Math.max(p1, 0), 100)}%`;
    }

    if (b2) {
        b2.style.width =
            `${Math.min(Math.max(p2, 0), 100)}%`;
    }

    if (b3) {
        b3.style.width =
            `${Math.min(Math.max(p3, 0), 100)}%`;
    }


    // =================================================
    // Validation
    // =================================================

    const totalBadge =
        document.getElementById("totalBadge");

    const warning =
        document.getElementById("validationWarning");

    const submitBtn =
        document.getElementById("submitBtn");


    if (totalBadge) {
        totalBadge.innerText =
            `${total}% / 100%`;
    }


    if (total !== 100) {

        if (totalBadge) {
            totalBadge.style.background =
                "rgba(239, 68, 68, 0.15)";

            totalBadge.style.color =
                "#f87171";

            totalBadge.style.borderColor =
                "rgba(239, 68, 68, 0.3)";
        }

        if (warning) {
            warning.style.display =
                "block";
        }

        if (submitBtn) {
            submitBtn.disabled =
                true;

            submitBtn.style.opacity =
                "0.5";

            submitBtn.style.cursor =
                "not-allowed";
        }

    } else {

        if (totalBadge) {
            totalBadge.style.background =
                "rgba(16, 185, 129, 0.15)";

            totalBadge.style.color =
                "#34d399";

            totalBadge.style.borderColor =
                "rgba(16, 185, 129, 0.3)";
        }

        if (warning) {
            warning.style.display =
                "none";
        }

        if (submitBtn) {
            submitBtn.disabled =
                false;

            submitBtn.style.opacity =
                "1";

            submitBtn.style.cursor =
                "pointer";
        }
    }


    // =================================================
    // Payment Preview
    // =================================================

    const escrowElement =
        document.getElementById("escrowAmount");

    const escrowInput =
        escrowElement
            ? parseFloat(escrowElement.value) || 0
            : 0;


    const prev1 =
        document.getElementById("prev_m1");

    const prev2 =
        document.getElementById("prev_m2");

    const prev3 =
        document.getElementById("prev_m3");


    if (escrowInput > 0) {

        if (prev1) {
            prev1.innerText =
                `${(escrowInput * p1 / 100).toFixed(3)} ETH (${p1}%)`;
        }

        if (prev2) {
            prev2.innerText =
                `${(escrowInput * p2 / 100).toFixed(3)} ETH (${p2}%)`;
        }

        if (prev3) {
            prev3.innerText =
                `${(escrowInput * p3 / 100).toFixed(3)} ETH (${p3}%)`;
        }

    } else {

        if (prev1) {
            prev1.innerText =
                `--- ETH (${p1}%)`;
        }

        if (prev2) {
            prev2.innerText =
                `--- ETH (${p2}%)`;
        }

        if (prev3) {
            prev3.innerText =
                `--- ETH (${p3}%)`;
        }
    }
}


// =====================================================
// CREATE AGREEMENT
// =====================================================

async function handleCreateAgreement(event) {

    event.preventDefault();


    // =================================================
    // 1. Validate milestones
    // =================================================

    const p1 =
        parseInt(
            document.getElementById("m1_pct").value
        ) || 0;

    const p2 =
        parseInt(
            document.getElementById("m2_pct").value
        ) || 0;

    const p3 =
        parseInt(
            document.getElementById("m3_pct").value
        ) || 0;


    if (
        p1 <= 0 ||
        p2 <= 0 ||
        p3 <= 0
    ) {

        alert(
            "Each milestone percentage must be greater than 0."
        );

        return;
    }


    if (
        p1 + p2 + p3 !== 100
    ) {

        alert(
            "Milestone percentages must equal 100%."
        );

        return;
    }


    const submitBtn =
        document.getElementById("submitBtn");


    if (submitBtn) {

        submitBtn.innerHTML =
            '<i class="fa-solid fa-spinner fa-spin"></i> Creating Agreement...';

        submitBtn.disabled =
            true;
    }


    try {

        // =================================================
        // 2. Check MetaMask
        // =================================================

        if (
            typeof window.ethereum ===
            "undefined"
        ) {

            throw new Error(
                "MetaMask is required."
            );
        }


        // =================================================
        // 3. Get wallet
        // =================================================

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
                "No MetaMask account connected."
            );
        }


        const currentAccount =
            accounts[0];


        // =================================================
        // 4. Initialize Web3
        // =================================================

        const web3 =
            new Web3(
                window.ethereum
            );


        const contract =
            new web3.eth.Contract(
                CONTRACT_ABI,
                CONTRACT_ADDRESS
            );


        // =================================================
        // 5. Read form values
        // =================================================

        const shipmentDetails =
            document.getElementById(
                "shipmentDetails"
            ).value.trim();


        const origin =
            document.getElementById(
                "origin"
            ).value.trim();


        const destination =
            document.getElementById(
                "destination"
            ).value.trim();


        const payloadValueInput =
            document.getElementById(
                "payloadValue"
            ).value.trim();


        const escrowInput =
            document.getElementById(
                "escrowAmount"
            ).value.trim();


        const priority =
            parseInt(
                document.getElementById(
                    "priority"
                ).value
            );


        // =================================================
        // 6. Validate form values
        // =================================================

        if (!shipmentDetails) {

            throw new Error(
                "Shipment details are required."
            );
        }


        if (!origin) {

            throw new Error(
                "Origin is required."
            );
        }


        if (!destination) {

            throw new Error(
                "Destination is required."
            );
        }


        // -------------------------------------------------
        // Payload value
        // -------------------------------------------------

        const payloadValue =
            Number(
                payloadValueInput
            );


        if (
            !Number.isFinite(
                payloadValue
            ) ||
            payloadValue <= 0
        ) {

            throw new Error(
                "Payload value must be greater than 0."
            );
        }


        // -------------------------------------------------
        // Escrow amount
        // -------------------------------------------------

        const escrowAmount =
            parseFloat(
                escrowInput
            );


        if (
            !Number.isFinite(
                escrowAmount
            ) ||
            escrowAmount < 0.01
        ) {

            throw new Error(
                "Minimum escrow amount is 0.01 ETH."
            );
        }


        // -------------------------------------------------
        // Priority
        // -------------------------------------------------

        if (
            !Number.isInteger(priority) ||
            priority < 0 ||
            priority > 2
        ) {

            throw new Error(
                "Invalid delivery priority."
            );
        }


        // =================================================
        // 7. Validate deadline
        // =================================================

        const deadlineValue =
            document.getElementById(
                "deadline"
            ).value;


        if (!deadlineValue) {

            throw new Error(
                "Delivery deadline is required."
            );
        }


        const deadlineDate =
            new Date(
                deadlineValue
            );


        if (
            isNaN(
                deadlineDate.getTime()
            )
        ) {

            throw new Error(
                "Invalid deadline."
            );
        }


        const deadlineTimestamp =
            Math.floor(
                deadlineDate.getTime() / 1000
            );


        const currentTimestamp =
            Math.floor(
                Date.now() / 1000
            );


        if (
            deadlineTimestamp <=
            currentTimestamp
        ) {

            throw new Error(
                "Deadline must be in the future."
            );
        }


        // =================================================
        // 8. Milestones
        // =================================================

        const checkpoints = [
            "Goods Pickup",
            "Warehouse Arrival",
            "Final Delivery"
        ];


        const percentages = [
            p1,
            p2,
            p3
        ];


        // =================================================
        // 9. CREATE AGREEMENT ON BLOCKCHAIN
        // =================================================

        const escrowWei = web3.utils.toWei(
            escrowAmount.toString(),
            "ether"
        );

        console.log(
            "========== CREATE + FUND AGREEMENT =========="
        );

        console.log("Shipment:", shipmentDetails);
        console.log("Payload:", payloadValue);
        console.log("Escrow:", escrowAmount, "ETH");
        console.log("Escrow Wei:", escrowWei);
        console.log("Deadline:", deadlineTimestamp);
        console.log("Priority:", priority);
        console.log("Checkpoints:", checkpoints);
        console.log("Percentages:", percentages);

        console.log(
            "Creating agreement AND funding escrow..."
        );

        const tx = await contract.methods
            .createAgreement(
                deadlineTimestamp.toString(),
                priority,
                checkpoints,
                percentages
            )
            .send({
                from: currentAccount,
                value: escrowWei
            });

        // =====================================================
        // TRANSACTION HASH
        // =====================================================

        const transactionHash =
            tx.transactionHash;

        console.log(
            "Blockchain transaction:",
            transactionHash
        );


        // =================================================
        // 10. Get AgreementCreated event
        // =================================================

        const eventLog =
            tx.events &&
            tx.events.AgreementCreated;


        if (!eventLog) {

            throw new Error(
                "AgreementCreated event was not found."
            );
        }


        const agreementId =
            Number(
                eventLog.returnValues
                    .agreementId
            );

        const referenceNo =
            eventLog.returnValues.referenceNo;



        if (
            !Number.isInteger(
                agreementId
            )
        ) {

            throw new Error(
                "Invalid agreement ID returned by contract."
            );
        }


        console.log(
            "Agreement ID:",
            agreementId
        );


        // =================================================
        // 11. Save agreement to Supabase
        // =================================================

        const priorityMap = [
            "Normal",
            "Express",
            "Urgent"
        ];


        const now =
            Math.floor(
                Date.now() / 1000
            );


        const agreementData = {
            agreement_id: agreementId,

            reference_no: referenceNo,

            shipper_address:
                currentAccount.toLowerCase(),

            carrier_address: null,

            shipment_details:
                shipmentDetails,

            payload_value:
                payloadValue,

            origin:
                origin,

            destination:
                destination,

            deadline:
                deadlineTimestamp,

            escrow_amount:
                escrowAmount,

            escrow_released:
                0,

            escrow_remaining:
                escrowAmount,

            priority:
                priorityMap[priority],

            status:
                "Created",

            current_milestone:
                0,

            created_time:
                now,

            accepted_at:
                null,

            completed_at:
                null,

            cancelled_at:
                null,

            expired_at:
                null,

            refunded_amount:
                0
        };


        console.log(
            "Saving agreement to Supabase:",
            agreementData
        );


        const {
            error:
            agreementError
        } =
            await supabaseClient
                .from("agreements")
                .insert([
                    agreementData
                ]);


        if (
            agreementError
        ) {

            console.error(
                "Supabase agreement error:",
                agreementError
            );

            throw new Error(
                "Blockchain agreement creation succeeded, but saving the agreement to Supabase failed: " +
                agreementError.message
            );
        }


        // =================================================
        // 12. Save milestones
        // =================================================

        const milestoneInserts =
            checkpoints.map(
                (
                    checkpoint,
                    index
                ) => ({

                    agreement_id:
                        agreementId,

                    milestone_index:
                        index,

                    checkpoint:
                        checkpoint,

                    percentage:
                        percentages[index],

                    completed:
                        false,

                    verified:
                        false
                })
            );


        const {
            error:
            milestoneError
        } =
            await supabaseClient
                .from("milestones")
                .insert(
                    milestoneInserts
                );


        if (
            milestoneError
        ) {

            console.error(
                "Supabase milestone error:",
                milestoneError
            );

            throw new Error(
                "Agreement was saved, but milestones could not be saved: " +
                milestoneError.message
            );
        }


        const transactionDetails = {

            reference_no:
                referenceNo,

            shipment_details:
                shipmentDetails,

            payload_value:
                payloadValue,

            escrow: {

                amount:
                    escrowAmount,

                currency:
                    "ETH",

                status:
                    "Funded",

                released:
                    0,

                remaining:
                    escrowAmount
            },

            priority:
                priorityMap[priority],

            deadline:
                deadlineTimestamp,

            origin:
                origin,

            destination:
                destination,

            checkpoints:
                checkpoints,

            percentages:
                percentages,

            message:
                "Agreement created and escrow funded during initialization."
        };


        // =====================================================
        // INSERT TRANSACTION
        // =====================================================

        const {
            error: transactionError
        } = await supabaseClient
            .from("transactions")
            .insert([{

                transaction_hash:
                    transactionHash,

                agreement_id:
                    agreementId,

                event_type:
                    "AgreementCreated",

                actor_address:
                    currentAccount.toLowerCase(),

                details:
                    transactionDetails
            }]);


        if (transactionError) {

            console.warn(
                "Transaction history logging failed:",
                transactionError
            );

        }


        // =================================================
        // 14. Success
        // =================================================

        alert(
            `Agreement #${agreementId} successfully created!\n\n` +
            `Status: Created\n` +
            `Escrow: Funded\n\n`
        );


        // Redirect to agreement list

        window.location.href =
            "agreements.html";


    } catch (error) {

        console.error(
            "================================="
        );

        console.error(
            "AGREEMENT CREATION FAILED"
        );

        console.error(
            error
        );

        console.error(
            "================================="
        );


        let message =
            error?.message ||
            String(error);


        if (
            error?.code === 4001
        ) {

            message =
                "Transaction was rejected in MetaMask.";
        }


        alert(
            "Agreement creation failed:\n\n" +
            message
        );


        if (submitBtn) {

            submitBtn.disabled =
                false;

            submitBtn.innerHTML =
                '<i class="fa-solid fa-circle-plus"></i> Create Agreement';
        }
    }
}


// =====================================================
// FORM LISTENERS
// =====================================================

document.addEventListener(
    "DOMContentLoaded",
    () => {

        const form =
            document.getElementById(
                "createAgreementForm"
            );


        if (form) {

            form.addEventListener(
                "submit",
                handleCreateAgreement
            );
        }


        const milestoneInputs = [
            "m1_pct",
            "m2_pct",
            "m3_pct",
            "escrowAmount"
        ];


        milestoneInputs.forEach(
            id => {

                const element =
                    document.getElementById(
                        id
                    );


                if (element) {

                    element.addEventListener(
                        "input",
                        updateMilestones
                    );
                }
            }
        );
    }
);