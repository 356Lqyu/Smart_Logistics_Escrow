document.addEventListener("DOMContentLoaded", () => {
    // Generate sample reference number preview
    const randomId = Math.floor(1000 + Math.random() * 9000);
    const refInput = document.getElementById("referenceNo");
    if (refInput) {
        refInput.value = `LG-2026-${randomId}`;
    }

    // Initialize progress bars and payment preview calculations
    updateMilestones();
});

function updateMilestones() {
    const p1 = parseInt(document.getElementById("m1_pct").value) || 0;
    const p2 = parseInt(document.getElementById("m2_pct").value) || 0;
    const p3 = parseInt(document.getElementById("m3_pct").value) || 0;
    const total = p1 + p2 + p3;

    // Update individual visual progress bar widths
    const b1 = document.getElementById("m1_bar");
    const b2 = document.getElementById("m2_bar");
    const b3 = document.getElementById("m3_bar");

    if (b1) b1.style.width = `${Math.min(Math.max(p1, 0), 100)}%`;
    if (b2) b2.style.width = `${Math.min(Math.max(p2, 0), 100)}%`;
    if (b3) b3.style.width = `${Math.min(Math.max(p3, 0), 100)}%`;

    // Validate 100% total
    const totalBadge = document.getElementById("totalBadge");
    const warning = document.getElementById("validationWarning");
    const submitBtn = document.getElementById("submitBtn");

    if (totalBadge) {
        totalBadge.innerText = `${total}% / 100%`;
    }

    if (total !== 100) {
        if (totalBadge) {
            totalBadge.style.background = "rgba(239, 68, 68, 0.15)";
            totalBadge.style.color = "#f87171";
            totalBadge.style.borderColor = "rgba(239, 68, 68, 0.3)";
        }
        if (warning) warning.style.display = "block";
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.style.opacity = "0.5";
            submitBtn.style.cursor = "not-allowed";
        }
    } else {
        if (totalBadge) {
            totalBadge.style.background = "rgba(16, 185, 129, 0.15)";
            totalBadge.style.color = "#34d399";
            totalBadge.style.borderColor = "rgba(16, 185, 129, 0.3)";
        }
        if (warning) warning.style.display = "none";
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.style.opacity = "1";
            submitBtn.style.cursor = "pointer";
        }
    }

    // Update payment preview calculations with escrow ETH input
    const escrowInput = parseFloat(document.getElementById("escrowAmount").value) || 0;
    const prev1 = document.getElementById("prev_m1");
    const prev2 = document.getElementById("prev_m2");
    const prev3 = document.getElementById("prev_m3");

    if (escrowInput > 0) {
        if (prev1) prev1.innerText = `${(escrowInput * (p1 / 100)).toFixed(3)} ETH (${p1}%)`;
        if (prev2) prev2.innerText = `${(escrowInput * (p2 / 100)).toFixed(3)} ETH (${p2}%)`;
        if (prev3) prev3.innerText = `${(escrowInput * (p3 / 100)).toFixed(3)} ETH (${p3}%)`;
    } else {
        if (prev1) prev1.innerText = `--- ETH (${p1}%)`;
        if (prev2) prev2.innerText = `--- ETH (${p2}%)`;
        if (prev3) prev3.innerText = `--- ETH (${p3}%)`;
    }
}

async function handleCreateAgreement(event) {
    event.preventDefault();

    const p1 = parseInt(document.getElementById("m1_pct").value) || 0;
    const p2 = parseInt(document.getElementById("m2_pct").value) || 0;
    const p3 = parseInt(document.getElementById("m3_pct").value) || 0;

    if (p1 + p2 + p3 !== 100) {
        alert("Milestone percentages must equal 100%!");
        return;
    }

    const submitBtn = document.getElementById("submitBtn");
    submitBtn.innerText = "Processing Transaction...";
    submitBtn.disabled = true;

    try {
        if (typeof window.ethereum === "undefined") {
            alert("MetaMask is required!");
            return;
        }

        const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
        const currentAccount = accounts[0];

        const web3 = new Web3(window.ethereum);
        const contract = new web3.eth.Contract(CONTRACT_ABI, CONTRACT_ADDRESS);

        const priority = parseInt(document.getElementById("priority").value);
        const notes = document.getElementById("notes").value;
        const payloadValue = document.getElementById("payloadValue").value;
        const escrowInput = document.getElementById("escrowAmount").value;
        const escrowWei = web3.utils.toWei(escrowInput, "ether");

        const deadlineDate = new Date(document.getElementById("deadline").value);
        const deadlineTimestamp = Math.floor(deadlineDate.getTime() / 1000);

        const checkpoints = ["Goods Pickup", "Warehouse Arrival", "Final Delivery"];
        const percentages = [p1, p2, p3];

        console.log("Creating agreement on blockchain...");

        // 1. Create Agreement on Smart Contract
        const tx = await contract.methods.createAgreement(
            "Shipment via LogisticsEscrow",
            notes,
            payloadValue,
            escrowWei,
            deadlineTimestamp,
            priority,
            checkpoints,
            percentages
        ).send({ from: currentAccount });

        const eventLog = tx.events.AgreementCreated;
        const agreementId = eventLog ? eventLog.returnValues.agreementId : 1;
        const referenceNo = document.getElementById("referenceNo").value;

        console.log("Funding Escrow...");

        // 2. Fund Escrow automatically
        await contract.methods.fundEscrow(agreementId).send({
            from: currentAccount,
            value: escrowWei
        });

        // 3. Save Agreement to Supabase Cache
        const priorityMap = ["Normal", "Express", "Urgent"];
        const { error: supabaseError } = await supabaseClient
            .from('agreements')
            .insert([{
                agreement_id: agreementId,
                reference_no: referenceNo,
                shipper_address: currentAccount.toLowerCase(),
                shipment_details: "Shipment via LogisticsEscrow",
                notes: notes,
                payload_value: parseFloat(payloadValue),
                escrow_amount: parseFloat(escrowInput),
                deadline: deadlineTimestamp,
                created_time: Math.floor(Date.now() / 1000),
                priority: priorityMap[priority],
                status: 'Funded'
            }]);

        if (supabaseError) {
            console.error("Supabase caching error:", supabaseError.message);
        }

        // 4. Save Milestones to Supabase
        const milestoneInserts = checkpoints.map((cp, idx) => ({
            agreement_id: agreementId,
            milestone_index: idx,
            checkpoint: cp,
            percentage: percentages[idx],
            completed: false,
            verified: false
        }));

        await supabaseClient.from('milestones').insert(milestoneInserts);

        alert("Agreement successfully created, funded, and cached!");
        window.location.href = "agreements.html";

    } catch (error) {
        console.error("Creation failed:", error);
        alert("Transaction failed: " + (error.message || error));
        submitBtn.innerText = "Create & Fund Agreement";
        submitBtn.disabled = false;
    }
}