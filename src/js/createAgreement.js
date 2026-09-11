const FIXED_MILESTONE_PERCENTAGES = [30, 30, 40];
const DEFAULT_ESCROW_BY_PRIORITY = {
  0: 0.1,
  1: 0.2,
  2: 0.3,
};
const WEI_PER_ETH = 10n ** 18n;
const INFURA_SEPOLIA_GAS_CAP = 16_000_000;

document.addEventListener("DOMContentLoaded", () => {
  updateMilestones();

  const form = document.getElementById("createAgreementForm");

  if (form) {
    form.addEventListener("submit", handleCreateAgreement);
    form.addEventListener("input", updateMilestones);
    form.addEventListener("change", updateMilestones);
  }

  ["origin", "destination"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("input", validateDestination);
      el.addEventListener("change", validateDestination);
    }
  });

  const payloadInput = document.getElementById("payloadValue");
  if (payloadInput) {
    payloadInput.addEventListener("input", validatePayload);
    payloadInput.addEventListener("change", validatePayload);
  }

  const escrowInput = document.getElementById("escrowAmount");
  if (escrowInput) {
    escrowInput.addEventListener("input", validateEscrowAmount);
  }

  const priorityInput = document.getElementById("priority");
  if (priorityInput) {
    priorityInput.addEventListener("change", setPriorityEscrowDefault);
  }

  const deadlineInput = document.getElementById("deadline");
  if (deadlineInput) {
    deadlineInput.addEventListener("input", validateDeadline);
    deadlineInput.addEventListener("change", validateDeadline);
  }

  validateEscrowAmount();
  validateDestination();
  validatePayload();
});

function getPriorityEscrowDefault() {
  const priority = Number(document.getElementById("priority")?.value);

  return (
    DEFAULT_ESCROW_BY_PRIORITY[priority] ?? DEFAULT_ESCROW_BY_PRIORITY[0]
  );
}

function setPriorityEscrowDefault() {
  const escrowInput = document.getElementById("escrowAmount");

  if (escrowInput) {
    escrowInput.value = getPriorityEscrowDefault().toFixed(3);
  }

  validateEscrowAmount();
}

function validateDestination() {
  const originInput = document.getElementById("origin");
  const destinationInput = document.getElementById("destination");
  const errorMessage = document.getElementById("destinationError");

  if (!originInput || !destinationInput) return true;

  const originVal = originInput.value.trim().toLowerCase();
  const destinationVal = destinationInput.value.trim().toLowerCase();
  const isSame =
    originVal !== "" && destinationVal !== "" && originVal === destinationVal;

  destinationInput.setCustomValidity(
    isSame ? "Destination cannot be the same as origin." : "",
  );

  if (errorMessage) {
    errorMessage.hidden = !isSame;
  }

  updateMilestones();
  return !isSame;
}

function validatePayload() {
  const payloadInput = document.getElementById("payloadValue");
  const errorMessage = document.getElementById("payloadValueError");

  if (!payloadInput) return true;

  const val = parseFloat(payloadInput.value);
  const isInvalid = payloadInput.value !== "" && (isNaN(val) || val <= 0);

  payloadInput.setCustomValidity(
    isInvalid ? "Payload value cannot be negative or zero." : "",
  );

  if (errorMessage) {
    errorMessage.hidden = !isInvalid;
  }

  updateMilestones();
  return !isInvalid;
}

function validateEscrowAmount() {
  const escrowInput = document.getElementById("escrowAmount");
  const errorMessage = document.getElementById("escrowAmountError");

  if (!escrowInput) {
    return true;
  }

  const escrowAmount = parseFloat(escrowInput.value);
  const isInvalid =
    escrowInput.value !== "" &&
    (!Number.isFinite(escrowAmount) || escrowAmount <= 0);

  escrowInput.setCustomValidity(
    isInvalid ? "Total escrow amount must be greater than 0 ETH." : "",
  );

  if (errorMessage) {
    errorMessage.hidden = !isInvalid;
  }

  updateMilestones();
  return !isInvalid;
}

function validateDeadline() {
  const deadlineInput = document.getElementById("deadline");
  const errorMessage = document.getElementById("deadlineError");

  if (!deadlineInput) {
    return true;
  }

  const deadlineTimestamp = new Date(deadlineInput.value).getTime();

  const isPastDeadline =
    deadlineInput.value !== "" &&
    Number.isFinite(deadlineTimestamp) &&
    deadlineTimestamp <= Date.now();

  deadlineInput.setCustomValidity(
    isPastDeadline ? "The delivery deadline must be in the future." : "",
  );

  if (errorMessage) {
    errorMessage.hidden = !isPastDeadline;
  }

  updateMilestones();
  return !isPastDeadline;
}

// MILESTONE PREVIEW

function ethToWei(ethAmount) {
  const value = String(ethAmount).trim();
  const match = value.match(/^(\d+)(?:\.(\d{1,18}))?$/);

  if (!match) {
    return null;
  }

  const [, whole, fraction = ""] = match;
  return BigInt(whole) * WEI_PER_ETH + BigInt(fraction.padEnd(18, "0"));
}

function formatWeiAsEth(weiAmount) {
  const wei = BigInt(weiAmount);
  const whole = wei / WEI_PER_ETH;
  const fraction = (wei % WEI_PER_ETH)
    .toString()
    .padStart(18, "0")
    .replace(/0+$/, "");

  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function calculateMilestonePayouts(escrowAmount, percentages) {
  const totalWei = ethToWei(escrowAmount);

  if (totalWei === null || totalWei <= 0n) {
    return null;
  }

  let remainingWei = totalWei;

  return percentages.map((percentage, index) => {
    // The final payout receives any wei left by integer division, matching the
    // contract and guaranteeing that all three payouts equal the total escrow.
    const payout =
      index === percentages.length - 1
        ? remainingWei
        : (totalWei * BigInt(percentage)) / 100n;

    remainingWei -= payout;
    return payout;
  });
}

function updateMilestones() {
  const [p1, p2, p3] = FIXED_MILESTONE_PERCENTAGES;

  ["m1_pct", "m2_pct", "m3_pct"].forEach((id, index) => {
    const input = document.getElementById(id);
    if (input) {
      input.value = FIXED_MILESTONE_PERCENTAGES[index];
    }
  });

  const total = p1 + p2 + p3;
  const totalBadge = document.getElementById("totalBadge");
  const warning = document.getElementById("validationWarning");
  const submitBtn = document.getElementById("submitBtn");

  if (totalBadge) {
    totalBadge.innerText = `${total}% / 100%`;
  }

  const milestonePercentagesAreValid =
    p1 > 0 && p2 > 0 && p3 > 0 && total === 100;

  const form = document.getElementById("createAgreementForm");
  const payloadValue = Number(document.getElementById("payloadValue")?.value);
  const escrowAmount = Number(document.getElementById("escrowAmount")?.value);
  const deadlineValue = document.getElementById("deadline")?.value;

  const deadlineIsInFuture =
    deadlineValue && new Date(deadlineValue).getTime() > Date.now();

  const valid =
    milestonePercentagesAreValid &&
    Boolean(form?.checkValidity()) &&
    Number.isFinite(payloadValue) &&
    payloadValue > 0 &&
    Number.isFinite(escrowAmount) &&
    escrowAmount > 0 &&
    deadlineIsInFuture;

  if (warning) {
    warning.style.display = valid ? "none" : "block";
  }

  if (submitBtn) {
    submitBtn.disabled = !valid;
    submitBtn.setAttribute("aria-disabled", String(!valid));
    submitBtn.style.opacity = valid ? "1" : "0.5";
    submitBtn.style.cursor = valid ? "pointer" : "not-allowed";
  }

  const payouts = calculateMilestonePayouts(
    document.getElementById("escrowAmount")?.value || "",
    [p1, p2, p3],
  );

  [
    ["prev_m1", p1],
    ["prev_m2", p2],
    ["prev_m3", p3],
  ].forEach(([id, percentage], index) => {
    const element = document.getElementById(id);

    if (!element) {
      return;
    }

    element.innerText =
      payouts
        ? `${formatWeiAsEth(payouts[index])} ETH (${percentage}%)`
        : `--- ETH (${percentage}%)`;
  });
}

// CREATE AGREEMENT + AUTO FUND

async function handleCreateAgreement(event) {
  event.preventDefault();

  const submitBtn = document.getElementById("submitBtn");

  try {
    const [p1, p2, p3] = FIXED_MILESTONE_PERCENTAGES;

    if (typeof window.ethereum === "undefined") {
      throw new Error("MetaMask is required.");
    }

    const accounts = await window.ethereum.request({
      method: "eth_requestAccounts",
    });

    if (!accounts || accounts.length === 0) {
      throw new Error("No MetaMask account connected.");
    }

    const currentAccount = accounts[0];
    const web3 = new Web3(window.ethereum);
    const chainId = Number(await web3.eth.getChainId());

    if (!SUPPORTED_CHAIN_IDS.includes(chainId)) {
      throw new Error(
        "Please connect MetaMask to local Ganache (chain ID 1337/5777) or Sepolia Testnet (chain ID 11155111).",
      );
    }

    const contract = new web3.eth.Contract(CONTRACT_ABI, CONTRACT_ADDRESS);

    const shipmentDetails = document
      .getElementById("shipmentDetails")
      ?.value.trim();

    const origin = document.getElementById("origin")?.value.trim();
    const destination = document.getElementById("destination")?.value.trim();
    const payloadValue = Number(document.getElementById("payloadValue")?.value);
    const escrowAmount = parseFloat(
      document.getElementById("escrowAmount")?.value,
    );

    const priority = parseInt(document.getElementById("priority")?.value);
    const deadlineValue = document.getElementById("deadline")?.value;

    if (!shipmentDetails) {
      throw new Error("Shipment details are required.");
    }

    if (!origin) {
      throw new Error("Origin is required.");
    }

    if (!destination) {
      throw new Error("Destination is required.");
    }

    if (!Number.isFinite(payloadValue) || payloadValue <= 0) {
      throw new Error("Payload value must be greater than 0.");
    }

    if (
      !Number.isFinite(escrowAmount) ||
      escrowAmount <= 0
    ) {
      throw new Error("Total escrow amount must be greater than 0 ETH.");
    }

    if (!Number.isInteger(priority) || priority < 0 || priority > 2) {
      throw new Error("Invalid delivery priority.");
    }

    if (!deadlineValue) {
      throw new Error("Delivery deadline is required.");
    }

    const deadlineDate = new Date(deadlineValue);

    if (isNaN(deadlineDate.getTime())) {
      throw new Error("Invalid deadline.");
    }

    const deadlineTimestamp = Math.floor(deadlineDate.getTime() / 1000);

    if (deadlineTimestamp <= Math.floor(Date.now() / 1000)) {
      throw new Error("Deadline must be in the future.");
    }

    const checkpoints = ["Goods Pickup", "Warehouse Arrival", "Final Delivery"];
    const percentages = [p1, p2, p3];

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML =
        '<i class="fa-solid fa-spinner fa-spin"></i> Creating & Funding...';
    }

    const escrowWei = web3.utils.toWei(escrowAmount.toString(), "ether");

    const createAgreementMethod = contract.methods.createAgreement(
      shipmentDetails,
      payloadValue.toString(),
      escrowWei,
      deadlineTimestamp.toString(),
      priority,
      checkpoints,
      percentages,
    );
    const transactionOptions = {
      from: currentAccount,
      value: escrowWei,
    };

    // Simulate first so contract reverts (including duplicate agreements) are
    // shown to the user instead of being submitted as a high-gas transaction.
    try {
      await createAgreementMethod.call(transactionOptions);
    } catch (error) {
      const message = error?.message || String(error);
      if (message.includes("Duplicate agreement detected")) {
        throw new Error(
          "Duplicate agreement detected. Change at least one agreement detail or the delivery deadline.",
        );
      }
      throw new Error(message);
    }

    const estimatedGas = await createAgreementMethod.estimateGas(
      transactionOptions,
    );
    const gas = Math.ceil(Number(estimatedGas) * 1.2);

    if (!Number.isSafeInteger(gas) || gas > INFURA_SEPOLIA_GAS_CAP) {
      throw new Error(
        "Unable to create the agreement because the required gas exceeds the Sepolia RPC limit.",
      );
    }

    const tx = await createAgreementMethod.send({
      ...transactionOptions,
      gas,
    });

    console.log("Agreement creation transaction:", tx.transactionHash);

    const eventLog = tx.events && tx.events.AgreementCreated;

    if (!eventLog) {
      throw new Error("AgreementCreated event was not found.");
    }

    const agreementId = Number(eventLog.returnValues.agreementId);
    const referenceNo = eventLog.returnValues.referenceNo;
    const priorityMap = ["Normal", "Express", "Urgent"];

    // SAVE AGREEMENT
    const agreementRow = {
      agreement_id: agreementId,
      reference_no: referenceNo,
      shipper_address: currentAccount.toLowerCase(),
      carrier_address: null,
      shipment_details: shipmentDetails,
      payload_value: payloadValue,
      origin: origin,
      destination: destination,
      deadline: deadlineTimestamp,
      escrow_amount: escrowAmount,
      escrow_released: 0,
      escrow_remaining: escrowAmount,
      priority: priorityMap[priority],
      status: "Created",
      current_milestone: 0,
      created_time: Math.floor(Date.now() / 1000),
      accepted_at: null,
      completed_at: null,
      cancelled_at: null,
      expired_at: null,
      refunded_amount: 0,
    };

    const { error: agreementError } = await supabaseClient
      .from("agreements")
      .insert([agreementRow]);

    if (agreementError) {
      throw new Error(
        "Blockchain creation succeeded, but Supabase agreement saving failed: " +
          agreementError.message,
      );
    }

    // SAVE MILESTONES

    const milestoneRows = checkpoints.map((checkpoint, index) => ({
      agreement_id: agreementId,
      milestone_index: index,
      checkpoint: checkpoint,
      percentage: percentages[index],
      completed: false,
      verified: false,
      paid: false,
      completed_at: null,
      verified_at: null,
      paid_at: null,
    }));

    const { error: milestoneError } = await supabaseClient
      .from("milestones")
      .insert(milestoneRows);

    if (milestoneError) {
      throw new Error(
        "Agreement was created, but milestone saving failed: " +
          milestoneError.message,
      );
    }

    // TRANSACTION HISTORY


    await supabaseClient.from("transactions").insert([
      {
        transaction_hash: tx.transactionHash,
        agreement_id: agreementId,
        event_type: "AgreementCreated",
        actor_address: currentAccount.toLowerCase(),
        details: {
          reference_no: referenceNo,
          escrow_amount: escrowAmount,
          escrow_funded: true,
          status: "Created",
          description:
            "Agreement created and escrow automatically funded and locked in the smart contract.",
        },
      },
    ]);

    alert(
      `Agreement ${referenceNo} created successfully!\n\n` +
        `Status: Created\n` +
        `Escrow: ${escrowAmount.toFixed(3)} ETH locked\n\n` +
        `The agreement is now available for a Carrier to accept.`,
    );

    window.location.href = "agreements.html";
  } catch (error) {
    console.error("Agreement creation failed:", error);

    let message = error?.message || String(error);

    if (error?.code === 4001) {
      message = "Transaction was rejected in MetaMask.";
    }

    alert("Agreement creation failed:\n\n" + message);

    if (submitBtn) {
      submitBtn.innerHTML =
        '<i class="fa-solid fa-circle-plus"></i> Create Agreement';
    }

    updateMilestones();
  }
}
