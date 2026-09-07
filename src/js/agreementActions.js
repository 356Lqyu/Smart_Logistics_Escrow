const MAX_ACTIVE_AGREEMENTS_PER_CARRIER = 3;

function getAcceptAgreementMessage(error) {
  if (error?.code === 4001) {
    return "Transaction was rejected in MetaMask.";
  }

  const details = [
    error?.data?.message,
    error?.data?.originalError?.message,
    error?.message,
    String(error || ""),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (details.includes("carrier already has 3 active agreements")) {
    return "You already have the maximum of 3 active agreements.\n\nComplete an active agreement before accepting another one.";
  }
  if (details.includes("agreement is not available for acceptance")) {
    return "This agreement is no longer available to accept. Please refresh the page.";
  }
  if (details.includes("deadline passed")) {
    return "This agreement has passed its deadline and can no longer be accepted.";
  }
  if (details.includes("shipper cannot be carrier")) {
    return "You cannot accept your own agreement as the carrier.";
  }
  if (details.includes("escrow is not fully funded")) {
    return "This agreement cannot be accepted until its escrow is fully funded.";
  }
  if (details.includes("carrier stake must equal 30% of escrow")) {
    return "This agreement requires an exact carrier stake equal to 30% of the escrow amount.";
  }

  return "We could not accept this agreement. Please refresh the page and try again.";
}

async function sharedAcceptAgreement(agreementId, referenceNo, onSuccess) {
  if (typeof window.ethereum === "undefined") {
    alert("MetaMask is required.");
    return;
  }

  try {
    const accounts = await window.ethereum.request({
      method: "eth_requestAccounts",
    });
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
        "Complete an active agreement before accepting another one.",
      );
      return;
    }

    const web3 = new Web3(window.ethereum);
    const contract = new web3.eth.Contract(CONTRACT_ABI, CONTRACT_ADDRESS);
    const chainAgreement = await contract.methods
      .getAgreementBasic(Number(agreementId))
      .call();
    const escrowWei = web3.utils.toBN(String(chainAgreement.escrowAmount));
    const stakeWei = escrowWei.muln(30).divn(100);
    const stakeEth = web3.utils.fromWei(stakeWei, "ether");

    if (
      !confirm(
        "Accept this logistics agreement?\n\n" +
        `Carrier stake to lock: ${stakeEth} ETH (30% of escrow)\n\n` +
        "After acceptance, the agreement becomes In Progress.",
      )
    )
      return;

    const tx = await contract.methods
      .acceptAgreement(Number(agreementId))
      .send({
        from: currentAccount,
        value: stakeWei.toString(),
      });
    const now = Math.floor(Date.now() / 1000);

    const { error: updateError } = await supabaseClient
      .from("agreements")
      .update({
        status: "In Progress",
        carrier_address: currentAccount,
        accepted_at: now,
      })
      .eq("agreement_id", Number(agreementId));

    if (updateError) throw updateError;

    const { error: transactionError } = await supabaseClient
      .from("transactions")
      .insert([
        {
          transaction_hash: tx.transactionHash,
          agreement_id: Number(agreementId),
          event_type: "AgreementAccepted",
          actor_address: currentAccount,
          details: {
            status: "In Progress",
            description: "Carrier accepted the logistics agreement.",
          },
        },
        {
          transaction_hash: `${tx.transactionHash}:carrier-stake-deposited`,
          agreement_id: Number(agreementId),
          event_type: "CarrierStakeDeposited",
          actor_address: currentAccount,
          details: {
            amount: Number(stakeEth),
            stake_amount: Number(stakeEth),
            blockchain_transaction_hash: tx.transactionHash,
            description: `Carrier locked ${stakeEth} ETH as the 30% performance stake.`,
          },
        },
      ]);

    if (transactionError) {
      throw new Error(
        `Agreement was accepted on-chain, but its history could not be saved: ${transactionError.message}`,
      );
    }

    alert(
      `Agreement ${referenceNo} accepted successfully!\n\n` +
      `Status: In Progress\n\n` +
      `Carrier stake locked: ${stakeEth} ETH\n\n` +
      `The agreement is now active and moving forward.`,
    );

    if (typeof onSuccess === "function") onSuccess();
    else window.location.reload();
  } catch (error) {
    console.error("Accept agreement failed:", error);
    if (
      String(error?.message || "").includes(
        "accepted on-chain, but its history could not be saved",
      )
    ) {
      alert(error.message);
      return;
    }
    alert(
      "Agreement cannot be accepted.\n\n" + getAcceptAgreementMessage(error),
    );
  }
}

async function sharedCancelAgreement(
  agreementId,
  referenceNo,
  escrowRemaining,
  currentStatus,
  onSuccess,
) {
  if (typeof window.ethereum === "undefined") {
    alert("MetaMask is required.");
    return;
  }

  if (String(currentStatus || "").toLowerCase() !== "created") {
    alert("Only a Created agreement can be cancelled.");
    return;
  }

  if (
    !confirm(
      "Cancel this agreement?\n\nThe complete remaining escrow will be refunded to the Shipper.",
    )
  )
    return;

  try {
    const accounts = await window.ethereum.request({
      method: "eth_requestAccounts",
    });
    const account = accounts[0];

    const web3 = new Web3(window.ethereum);
    const contract = new web3.eth.Contract(CONTRACT_ABI, CONTRACT_ADDRESS);

    const tx = await contract.methods
      .cancelAgreement(Number(agreementId))
      .send({ from: account });
    const refund = Number(escrowRemaining || 0);

    await supabaseClient
      .from("agreements")
      .update({
        status: "Cancelled",
        cancelled_at: Math.floor(Date.now() / 1000),
        refunded_amount: refund,
        // A cancellation returns the escrow to the shipper; it is
        // never a release to the carrier.
        escrow_released: 0,
        escrow_remaining: 0,
      })
      .eq("agreement_id", Number(agreementId));

    await supabaseClient.from("transactions").insert([
      {
        transaction_hash: tx.transactionHash,
        agreement_id: Number(agreementId),
        event_type: "AgreementCancelled",
        actor_address: account.toLowerCase(),
        details: {
          status: "Cancelled",
          escrow_refunded: refund,
          description: "Agreement cancelled and escrow refunded to shipper.",
        },
      },
    ]);

    alert(
      `Agreement ${referenceNo} cancelled successfully!\n\n` +
      `Status: Cancelled\n` +
      `Refunded: ${refund.toFixed(3)} ETH returned to Shipper\n\n` +
      `The escrow has been successfully refunded to the Shipper.`,
    );

    if (typeof onSuccess === "function") onSuccess();
    else window.location.reload();
  } catch (error) {
    alert("Cancellation failed:\n\n" + (error?.message || error));
  }
}

async function sharedRequestExtension(
  agreementId,
  newDeadlineTimestamp,
  reason,
  walletAddress,
  onSuccess,
) {
  try {
    const { data, error } = await supabaseClient
      .from("agreements")
      .update({
        extension_requested_deadline: newDeadlineTimestamp,
        extension_request_reason: reason,
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

    await supabaseClient.from("transactions").insert([
      {
        transaction_hash: "N/A-" + Date.now(),
        agreement_id: Number(agreementId),
        event_type: "DeadlineExtensionRequested",
        actor_address: String(walletAddress || "").toLowerCase(),
        details: {
          requested_deadline: newDeadlineTimestamp,
          reason: reason,
          description: "Carrier requested deadline extension.",
        },
      },
    ]);

    alert("Extension request submitted successfully to Shipper.");
    if (typeof onSuccess === "function") onSuccess();
    else window.location.reload();
  } catch (err) {
    alert("Failed to submit extension request: " + (err?.message || err));
  }
}

async function sharedApproveExtension(
  agreementId,
  referenceNo,
  requestedDeadline,
  onSuccess,
) {
  if (typeof window.ethereum === "undefined") {
    alert("MetaMask is required.");
    return;
  }

  try {
    const accounts = await window.ethereum.request({
      method: "eth_requestAccounts",
    });
    const account = accounts[0].toLowerCase();

    const web3 = new Web3(window.ethereum);
    const contract = new web3.eth.Contract(CONTRACT_ABI, CONTRACT_ADDRESS);

    const tx = await contract.methods
      .extendDeadline(Number(agreementId), requestedDeadline)
      .send({ from: account });

    const { error } = await supabaseClient
      .from("agreements")
      .update({
        deadline: requestedDeadline,
        extension_requested_deadline: null,
        extension_request_reason: null,
      })
      .eq("agreement_id", Number(agreementId));

    if (error) throw error;

    await supabaseClient.from("transactions").insert([
      {
        transaction_hash: tx.transactionHash,
        agreement_id: Number(agreementId),
        event_type: "DeadlineExtended",
        actor_address: account,
        details: {
          new_deadline: requestedDeadline,
          description: "Shipper approved deadline extension.",
        },
      },
    ]);

    const formattedDate = new Date(
      Number(requestedDeadline) * 1000,
    ).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

    alert(
      `Agreement ${referenceNo} deadline extended successfully!\n\n` +
      `New Deadline: ${formattedDate}\n\n` +
      `The agreement schedule has been updated.`,
    );

    if (typeof onSuccess === "function") onSuccess();
    else window.location.reload();
  } catch (err) {
    alert("Failed to approve extension: " + (err?.message || err));
  }
}

async function sharedRejectExtension(agreementId, referenceNo, onSuccess) {
  try {
    if (typeof window.ethereum === "undefined")
      throw new Error("MetaMask is required.");
    const accounts = await window.ethereum.request({
      method: "eth_requestAccounts",
    });
    const account = accounts[0].toLowerCase();

    const { error } = await supabaseClient
      .from("agreements")
      .update({
        extension_requested_deadline: null,
        extension_request_reason: null,
      })
      .eq("agreement_id", Number(agreementId));

    if (error) throw error;

    await supabaseClient.from("transactions").insert([
      {
        transaction_hash: "N/A-" + Date.now(),
        agreement_id: Number(agreementId),
        event_type: "DeadlineExtensionRejected",
        actor_address: account,
        details: {
          description: "Shipper rejected deadline extension request.",
        },
      },
    ]);

    alert(
      `Agreement ${referenceNo} extension request rejected.\n\n` +
      `The original deadline remains in effect.`,
    );

    if (typeof onSuccess === "function") onSuccess();
    else window.location.reload();
  } catch (err) {
    alert("Failed to reject extension: " + (err?.message || err));
  }
}
