const MAX_ACTIVE_AGREEMENTS_PER_CARRIER = 3;

async function sharedAcceptAgreement(agreementId, referenceNo, onSuccess) {
    if (typeof window.ethereum === "undefined") {
        alert("MetaMask is required.");
        return;
    }

    try {
        const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
        const currentAccount = accounts[0].toLowerCase();

        // Always re-check immediately before asking the carrier to sign. This
        // protects the Agreements and Agreement Details acceptance flows even
        // when their displayed lists are stale.
        const { count, error: activeCountError } = await supabaseClient
            .from("agreements")
            .select("agreement_id", { count: "exact", head: true })
            .eq("carrier_address", currentAccount)
            .eq("status", "In Progress");

        if (activeCountError) throw activeCountError;
        if ((count || 0) >= MAX_ACTIVE_AGREEMENTS_PER_CARRIER) {
            alert(
                `You already have ${MAX_ACTIVE_AGREEMENTS_PER_CARRIER} agreements in progress. ` +
                "Complete an active agreement before accepting another one."
            );
            return;
        }

        const web3 = new Web3(window.ethereum);
        const contract = new web3.eth.Contract(CONTRACT_ABI, CONTRACT_ADDRESS);

        if (!confirm("Accept this logistics agreement?\n\nAfter acceptance, the agreement becomes In Progress.")) return;

        const tx = await contract.methods.acceptAgreement(Number(agreementId)).send({ from: currentAccount });
        const now = Math.floor(Date.now() / 1000);

        const { error: updateError } = await supabaseClient
            .from("agreements")
            .update({ status: "In Progress", carrier_address: currentAccount, accepted_at: now })
            .eq("agreement_id", Number(agreementId));

        if (updateError) throw updateError;

        await supabaseClient.from("transactions").insert([{
            transaction_hash: tx.transactionHash,
            agreement_id: Number(agreementId),
            event_type: "AgreementAccepted",
            actor_address: currentAccount,
            details: { status: "In Progress", description: "Carrier accepted the logistics agreement." }
        }]);

        alert(
            `Agreement ${referenceNo} accepted successfully!\n\n` +
            `Status: In Progress\n\n` +
            `The agreement is now active and moving forward.`
        );

        if (typeof onSuccess === "function") onSuccess();
        else window.location.reload();
    } catch (error) {
        alert("Failed to accept agreement:\n\n" + (error?.message || error));
    }
}

async function sharedCancelAgreement(agreementId, referenceNo, escrowRemaining, currentStatus, onSuccess) {
    if (typeof window.ethereum === "undefined") {
        alert("MetaMask is required.");
        return;
    }

    if (String(currentStatus || "").toLowerCase() !== "created") {
        alert("Only a Created agreement can be cancelled.");
        return;
    }

    if (!confirm("Cancel this agreement?\n\nThe complete remaining escrow will be refunded to the Shipper.")) return;

    try {
        const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
        const account = accounts[0];

        const web3 = new Web3(window.ethereum);
        const contract = new web3.eth.Contract(CONTRACT_ABI, CONTRACT_ADDRESS);

        const tx = await contract.methods.cancelAgreement(Number(agreementId)).send({ from: account });
        const refund = Number(escrowRemaining || 0);

        await supabaseClient
            .from("agreements")
            .update({
                status: "Cancelled",
                cancelled_at: Math.floor(Date.now() / 1000),
                refunded_amount: refund,
                escrow_released: refund,
                escrow_remaining: 0
            })
            .eq("agreement_id", Number(agreementId));

        await supabaseClient.from("transactions").insert([{
            transaction_hash: tx.transactionHash,
            agreement_id: Number(agreementId),
            event_type: "AgreementCancelled",
            actor_address: account.toLowerCase(),
            details: { status: "Cancelled", escrow_refunded: refund, description: "Agreement cancelled and escrow refunded to shipper." }
        }]);

        alert(
            `Agreement ${referenceNo} cancelled successfully!\n\n` +
            `Status: Cancelled\n` +
            `Refunded: ${refund.toFixed(3)} ETH returned to Shipper\n\n` +
            `The escrow has been successfully refunded to the Shipper.`
        );

        if (typeof onSuccess === "function") onSuccess();
        else window.location.reload();
    } catch (error) {
        alert("Cancellation failed:\n\n" + (error?.message || error));
    }
}

async function sharedRequestExtension(agreementId, newDeadlineTimestamp, reason, walletAddress, onSuccess) {
    try {
        const { data, error } = await supabaseClient
            .from("agreements")
            .update({
                extension_requested_deadline: newDeadlineTimestamp,
                extension_request_reason: reason
            })
            .eq("agreement_id", Number(agreementId))
            .is("extension_requested_deadline", null)
            .select("agreement_id");

        if (error) throw error;
        if (!data || data.length === 0) {
            throw new Error("An extension request already exists for this agreement.");
        }

        await supabaseClient.from("transactions").insert([{
            transaction_hash: "N/A-" + Date.now(),
            agreement_id: Number(agreementId),
            event_type: "DeadlineExtensionRequested",
            actor_address: String(walletAddress || "").toLowerCase(),
            details: { requested_deadline: newDeadlineTimestamp, reason: reason, description: "Carrier requested deadline extension." }
        }]);

        alert("Extension request submitted successfully to Shipper.");
        if (typeof onSuccess === "function") onSuccess();
        else window.location.reload();
    } catch (err) {
        alert("Failed to submit extension request: " + (err?.message || err));
    }
}

async function sharedApproveExtension(agreementId, referenceNo, requestedDeadline, onSuccess) {
    if (typeof window.ethereum === "undefined") {
        alert("MetaMask is required.");
        return;
    }

    try {
        const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
        const account = accounts[0].toLowerCase();

        const web3 = new Web3(window.ethereum);
        const contract = new web3.eth.Contract(CONTRACT_ABI, CONTRACT_ADDRESS);

        const tx = await contract.methods.extendDeadline(Number(agreementId), requestedDeadline).send({ from: account });

        const { error } = await supabaseClient
            .from("agreements")
            .update({
                deadline: requestedDeadline,
                extension_requested_deadline: null,
                extension_request_reason: null
            })
            .eq("agreement_id", Number(agreementId));

        if (error) throw error;

        await supabaseClient.from("transactions").insert([{
            transaction_hash: tx.transactionHash,
            agreement_id: Number(agreementId),
            event_type: "DeadlineExtended",
            actor_address: account,
            details: { new_deadline: requestedDeadline, description: "Shipper approved deadline extension." }
        }]);

        const formattedDate = new Date(Number(requestedDeadline) * 1000).toLocaleString("en-US", {
            year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
        });

        alert(
            `Agreement ${referenceNo} deadline extended successfully!\n\n` +
            `New Deadline: ${formattedDate}\n\n` +
            `The agreement schedule has been updated.`
        );

        if (typeof onSuccess === "function") onSuccess();
        else window.location.reload();
    } catch (err) {
        alert("Failed to approve extension: " + (err?.message || err));
    }
}

async function sharedRejectExtension(agreementId, referenceNo, onSuccess) {
    try {
        if (typeof window.ethereum === "undefined") throw new Error("MetaMask is required.");
        const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
        const account = accounts[0].toLowerCase();

        const { error } = await supabaseClient
            .from("agreements")
            .update({
                extension_requested_deadline: null,
                extension_request_reason: null
            })
            .eq("agreement_id", Number(agreementId));

        if (error) throw error;

        await supabaseClient.from("transactions").insert([{
            transaction_hash: "N/A-" + Date.now(),
            agreement_id: Number(agreementId),
            event_type: "DeadlineExtensionRejected",
            actor_address: account,
            details: { description: "Shipper rejected deadline extension request." }
        }]);

        alert(
            `Agreement ${referenceNo} extension request rejected.\n\n` +
            `The original deadline remains in effect.`
        );

        if (typeof onSuccess === "function") onSuccess();
        else window.location.reload();
    } catch (err) {
        alert("Failed to reject extension: " + (err?.message || err));
    }
}
