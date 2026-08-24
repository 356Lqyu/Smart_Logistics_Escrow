// =====================================================
// AGREEMENTS PAGE
// =====================================================

let allAgreements = [];
let filteredAgreements = [];


// =====================================================
// INITIALIZE
// =====================================================

document.addEventListener(
    "DOMContentLoaded",
    async () => {

        try {

            await loadAgreements();

            await processExpiredAgreements();

            await loadAgreements();

            setupFilters();
            setupSearch();

            renderAgreements();

        } catch (error) {

            console.error(
                "Agreements page failed:",
                error
            );

            showAgreementsError(
                error.message ||
                String(error)
            );
        }
    }
);


// =====================================================
// LOAD AGREEMENTS
// =====================================================

async function loadAgreements() {

    const currentWallet = localStorage.getItem("wallet");
    const userRole = localStorage.getItem("role");

    const {
        data: rawAgreements,
        error
    } =
        await supabaseClient
            .from("agreements")
            .select("*")
            .order(
                "agreement_id",
                {
                    ascending:
                        false
                }
            );

    if (error) {
        throw error;
    }

    // -------------------------------------------------
    // Strict Role-Based Post-Filtering
    // -------------------------------------------------
    let agreements = rawAgreements || [];
    const roleStr = String(userRole || "").toLowerCase();
    const isCarrierUser = (roleStr === "2" || roleStr === "carrier");
    const isShipperUser = (roleStr === "1" || roleStr === "shipper");

    const newAgreementBtn = document.getElementById("new-agreement-btn");
    if (newAgreementBtn) {
        if (isCarrierUser) {
            newAgreementBtn.style.display = "none"; // Hide button for carriers
        } else {
            newAgreementBtn.style.display = "flex"; // Show for shippers
        }
    }

    if (isShipperUser && currentWallet) {
        const walletLower = currentWallet.toLowerCase();
        agreements = agreements.filter(a =>
            a.shipper_address && a.shipper_address.toLowerCase() === walletLower
        );
    } else if (isCarrierUser && currentWallet) {
        const walletLower = currentWallet.toLowerCase();
        agreements = agreements.filter(a => {
            const status = String(a.status || "").toLowerCase();
            if (status === "created") {
                return true;
            }
            if (status === "in progress") {
                return a.carrier_address && a.carrier_address.toLowerCase() === walletLower;
            }
            return a.carrier_address && a.carrier_address.toLowerCase() === walletLower;
        });
    }

    allAgreements = agreements;

    // -------------------------------------------------
    // Load blockchain state
    // -------------------------------------------------

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

        for (
            let i = 0;
            i < allAgreements.length;
            i++
        ) {

            const agreement =
                allAgreements[i];

            try {

                const chainAgreement =
                    await contract.methods
                        .getAgreementBasic(
                            Number(
                                agreement.agreement_id
                            )
                        )
                        .call();

                agreement.blockchain_escrow =
                    chainAgreement.escrowAmount;

                agreement.blockchain_escrow_remaining =
                    chainAgreement.escrowRemaining;

                agreement.blockchain_shipper =
                    chainAgreement.shipper;

                agreement.blockchain_carrier =
                    chainAgreement.carrier;

                agreement.blockchain_status =
                    Number(
                        chainAgreement.status
                    );

                agreement.blockchain_current_milestone =
                    Number(
                        chainAgreement.currentMilestone
                    );

                agreement.blockchain_deadline =
                    Number(
                        chainAgreement.deadline
                    );

            } catch (error) {

                console.warn(
                    `Could not load blockchain agreement ${agreement.agreement_id}:`,
                    error
                );
            }
        }
    }
}


// =====================================================
// PROCESS EXPIRED AGREEMENTS
// =====================================================
//
// This is intentionally called from the agreements page.
//
// Therefore:
//
// - Carrier opens Agreements page
// - Expired agreement is detected
// - expireAgreement() is called
// - Smart contract refunds Shipper
// - Supabase status becomes Expired
//
// =====================================================

async function processExpiredAgreements() {

    if (
        typeof window.ethereum ===
        "undefined"
    ) {

        console.warn(
            "MetaMask unavailable. Cannot process blockchain expiry."
        );

        return;
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

    const now =
        Math.floor(
            Date.now() / 1000
        );

    for (
        const agreement of allAgreements
    ) {

        const deadline =
            Number(
                agreement.blockchain_deadline ||
                agreement.deadline ||
                0
            );

        if (!deadline) {
            continue;
        }

        // Not expired
        if (
            now <=
            deadline
        ) {
            continue;
        }

        const blockchainStatus =
            Number(
                agreement.blockchain_status
            );

        // -------------------------------------------------
        // Completed
        // -------------------------------------------------

        if (
            blockchainStatus ===
            2
        ) {
            continue;
        }

        // -------------------------------------------------
        // Cancelled
        // -------------------------------------------------

        if (
            blockchainStatus ===
            3
        ) {
            continue;
        }

        // -------------------------------------------------
        // Already expired
        // -------------------------------------------------

        if (
            blockchainStatus ===
            4
        ) {

            await syncExpiredAgreement(
                agreement,
                null,
                null
            );

            continue;
        }

        // -------------------------------------------------
        // Need to expire
        // -------------------------------------------------

        try {

            const accounts =
                await window.ethereum.request({
                    method:
                        "eth_requestAccounts"
                });

            if (
                !accounts ||
                accounts.length ===
                0
            ) {

                console.warn(
                    "No wallet connected. Cannot expire agreement."
                );

                continue;
            }

            const account =
                accounts[0];

            // -------------------------------------------------
            // Re-check blockchain state
            // -------------------------------------------------

            const chainAgreement =
                await contract.methods
                    .getAgreementBasic(
                        Number(
                            agreement.agreement_id
                        )
                    )
                    .call();

            const currentStatus =
                Number(
                    chainAgreement.status
                );

            if (
                currentStatus === 2 ||
                currentStatus === 3
            ) {
                continue;
            }

            if (
                currentStatus === 4
            ) {

                agreement.blockchain_status =
                    4;

                await syncExpiredAgreement(
                    agreement,
                    null,
                    null
                );

                continue;
            }

            const chainDeadline =
                Number(
                    chainAgreement.deadline
                );

            if (
                now <=
                chainDeadline
            ) {
                continue;
            }

            // -------------------------------------------------
            // Expiry transaction
            // -------------------------------------------------

            const confirmed =
                confirm(
                    `Agreement ${agreement.reference_no} has expired.\n\n` +
                    "The remaining escrow will be refunded to the Shipper.\n\n" +
                    "Process expiry now?"
                );

            if (!confirmed) {
                continue;
            }

            const tx =
                await contract.methods
                    .expireAgreement(
                        Number(
                            agreement.agreement_id
                        )
                    )
                    .send({
                        from:
                            account
                    });

            console.log(
                `Agreement ${agreement.agreement_id} expired:`,
                tx.transactionHash
            );

            agreement.blockchain_status =
                4;

            agreement.blockchain_escrow_remaining =
                "0";

            await syncExpiredAgreement(
                agreement,
                tx.transactionHash,
                account
            );

        } catch (error) {

            console.error(
                `Could not expire agreement ${agreement.agreement_id}:`,
                error
            );

            if (
                error?.code ===
                4001
            ) {

                alert(
                    `Expiry transaction for ${agreement.reference_no} was rejected in MetaMask.`
                );
            }
        }
    }
}


// =====================================================
// SYNC EXPIRED AGREEMENT
// =====================================================

async function syncExpiredAgreement(
    agreement,
    transactionHash,
    actor
) {

    try {

        const remaining =
            getBlockchainEth(
                agreement.blockchain_escrow_remaining,
                agreement.escrow_remaining
            );

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
                        remaining,

                    escrow_remaining:
                        0,

                    escrow_released:
                        Number(
                            agreement.escrow_released ||
                            0
                        ) +
                        remaining

                })
                .eq(
                    "agreement_id",
                    Number(
                        agreement.agreement_id
                    )
                );

        if (error) {

            console.error(
                "Failed to synchronize expired agreement:",
                error
            );

            return;
        }

        agreement.status =
            "Expired";

        agreement.expired_at =
            Math.floor(
                Date.now() / 1000
            );

        agreement.escrow_remaining =
            0;

        agreement.refunded_amount =
            remaining;

        // -------------------------------------------------
        // Transaction record
        // -------------------------------------------------

        if (
            transactionHash &&
            actor
        ) {

            await supabaseClient
                .from("transactions")
                .insert([
                    {

                        transaction_hash:
                            transactionHash,

                        agreement_id:
                            Number(
                                agreement.agreement_id
                            ),

                        event_type:
                            "AgreementExpired",

                        actor_address:
                            actor.toLowerCase(),

                        details:
                        {

                            status:
                                "Expired",

                            escrow_refunded:
                                remaining,

                            description:
                                "Agreement expired after the deadline. Remaining escrow was refunded to the Shipper."
                        }
                    }
                ]);
        }

    } catch (error) {

        console.error(
            "Expired agreement synchronization failed:",
            error
        );
    }
}


// =====================================================
// FILTERS
// =====================================================

function setupFilters() {

    document
        .querySelectorAll(
            ".filter-btn"
        )
        .forEach(
            button => {

                button.addEventListener(
                    "click",
                    () => {

                        document
                            .querySelectorAll(
                                ".filter-btn"
                            )
                            .forEach(
                                btn =>
                                    btn.classList.remove(
                                        "active"
                                    )
                            );

                        button.classList.add(
                            "active"
                        );

                        renderAgreements();
                    }
                );
            }
        );
}


// =====================================================
// SEARCH
// =====================================================

function setupSearch() {

    const searchInputs = [
        document.getElementById(
            "search-input"
        ),

        document.getElementById(
            "table-search-input"
        )
    ];

    searchInputs.forEach(
        input => {

            if (!input) {
                return;
            }

            input.addEventListener(
                "input",
                renderAgreements
            );
        }
    );
}


// =====================================================
// RENDER
// =====================================================

function renderAgreements() {

    const tbody =
        document.getElementById(
            "agreements-table-body"
        );

    if (!tbody) {
        return;
    }

    const activeFilter =
        document.querySelector(
            ".filter-btn.active"
        )?.dataset.filter ||
        "all";

    const searchValue =
        (
            document.getElementById(
                "table-search-input"
            )?.value ||
            document.getElementById(
                "search-input"
            )?.value ||
            ""
        )
            .trim()
            .toLowerCase();

    filteredAgreements =
        allAgreements.filter(
            agreement => {

                const status =
                    getEffectiveStatus(
                        agreement
                    );

                const reference =
                    String(
                        agreement.reference_no ||
                        ""
                    ).toLowerCase();

                const payload =
                    String(
                        agreement.payload_value ||
                        ""
                    ).toLowerCase();

                const searchMatch =
                    !searchValue ||
                    reference.includes(
                        searchValue
                    ) ||
                    payload.includes(
                        searchValue
                    );

                const filterMatch =
                    activeFilter ===
                    "all" ||
                    status.toLowerCase() ===
                    activeFilter.toLowerCase();

                return (
                    searchMatch &&
                    filterMatch
                );
            }
        );

    tbody.innerHTML =
        "";

    if (
        filteredAgreements.length ===
        0
    ) {

        tbody.innerHTML = `
            <tr>
                <td
                    colspan="9"
                    style="
                        text-align:center;
                        color:#8d99ae;
                        padding:30px;
                    "
                >
                    No agreements found.
                </td>
            </tr>
        `;

        return;
    }

    filteredAgreements.forEach(
        agreement => {

            const status =
                getEffectiveStatus(
                    agreement
                );

            const shipper =
                agreement.blockchain_shipper ||
                agreement.shipper_address;

            const carrier =
                agreement.blockchain_carrier ||
                agreement.carrier_address;

            const escrow =
                getBlockchainEth(
                    agreement.blockchain_escrow,
                    agreement.escrow_amount
                );

            const deadline =
                Number(
                    agreement.blockchain_deadline ||
                    agreement.deadline
                );

            // =================================================
            // ACTION BUTTONS DEFINITION
            // =================================================

            const userRole = localStorage.getItem("role") || "";
            const currentWallet = (localStorage.getItem("wallet") || "").toLowerCase();

            const isCarrierUser = (userRole === "2" || userRole.toLowerCase() === "carrier");
            const isShipperUser = (userRole === "1" || userRole.toLowerCase() === "shipper");

            const isCreated = (status === "Created");
            const isOwnerShipper = shipper && shipper.toLowerCase() === currentWallet;

            let actionButtons = `
                <button
                    class="view-btn"
                    onclick="viewAgreement(${Number(agreement.agreement_id)})"
                >
                    <i class="fa-regular fa-eye"></i>
                    View
                </button>
            `;

            // Carrier Accept button
            if (isCarrierUser && isCreated) {
                actionButtons += `
                    <button
                        class="accept-btn"
                        style="margin-left: 5px;"
                        onclick="acceptAgreementAction(${Number(agreement.agreement_id)})"
                    >
                        <i class="fa-solid fa-check"></i>
                        Accept
                    </button>
                `;
            }

            // Shipper Cancel button (Only for created agreements they own)
            if (isShipperUser && isCreated && isOwnerShipper) {
                actionButtons += `
                    <button
                        class="cancel-btn"
                        style="margin-left: 5px;"
                        onclick="cancelAgreementAction(${Number(agreement.agreement_id)})"
                    >
                        <i class="fa-solid fa-xmark"></i>
                        Cancel
                    </button>
                `;
            }

            const row =
                document.createElement(
                    "tr"
                );

            row.innerHTML = `
                <td>
                    ${escapeHtml(
                agreement.reference_no
            )}
                </td>

                <td>
                    ${shortenAddress(
                shipper
            )}
                </td>

                <td>
                    ${shortenAddress(
                carrier
            )}
                </td>

                <td>
                    $${Number(
                agreement.payload_value ||
                0
            ).toLocaleString(
                undefined,
                {
                    minimumFractionDigits:
                        2,
                    maximumFractionDigits:
                        2
                }
            )}
                </td>

                <td>
                    ${escapeHtml(
                agreement.priority ||
                "Normal"
            )}
                </td>

                <td>
                    ${escrow.toFixed(
                3
            )} ETH
                </td>

                <td>
                    ${formatDate(
                deadline
            )}
                </td>

                <td>
                    <span
                        class="status-badge ${getStatusClass(
                status
            )}"
                    >
                        <span class="status-dot"></span>
                        ${escapeHtml(
                status
            )}
                    </span>
                </td>

                 <td>
                    ${actionButtons}
                </td>
            `;

            tbody.appendChild(
                row
            );
        }
    );
}


async function acceptAgreementAction(agreementId) {
    try {
        if (typeof window.ethereum === "undefined") {
            throw new Error("MetaMask is required.");
        }

        const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
        const currentAccount = accounts[0].toLowerCase();

        // Find the agreement in local state to check its shipper
        const targetAgreement = allAgreements.find(a => Number(a.agreement_id) === Number(agreementId));
        const shipperAddress = (targetAgreement?.blockchain_shipper || targetAgreement?.shipper_address || "").toLowerCase();

        if (shipperAddress && currentAccount === shipperAddress) {
            alert("Action Denied: Shippers cannot accept their own logistics agreements as carriers.");
            return;
        }

        const web3 = new Web3(window.ethereum);
        const contract = new web3.eth.Contract(CONTRACT_ABI, CONTRACT_ADDRESS);

        const confirmed = confirm("Accept this logistics agreement?\n\nAfter acceptance, the agreement becomes In Progress.");
        if (!confirmed) return;

        const tx = await contract.methods.acceptAgreement(Number(agreementId)).send({
            from: currentAccount
        });

        const now = Math.floor(Date.now() / 1000);

        await supabaseClient
            .from("agreements")
            .update({
                status: "In Progress",
                carrier_address: currentAccount,
                accepted_at: now
            })
            .eq("agreement_id", agreementId);

        await supabaseClient.from("transactions").insert([{
            transaction_hash: tx.transactionHash,
            agreement_id: Number(agreementId),
            event_type: "AgreementAccepted",
            actor_address: currentAccount,
            details: {
                status: "In Progress",
                description: "Carrier accepted the logistics agreement."
            }
        }]);

        alert("Agreement accepted successfully.\n\nStatus: In Progress");
        window.location.reload();

    } catch (error) {
        console.error("Acceptance failed:", error);
        let message = error?.message || String(error);
        if (error?.code === 4001) {
            message = "Transaction was rejected in MetaMask.";
        }
        alert("Failed to accept agreement:\n\n" + message);
    }
}

// =====================================================
// SHIPPER CANCEL AGREEMENT FROM LISTING PAGE
// =====================================================

async function cancelAgreementAction(agreementId) {
    if (typeof window.ethereum === "undefined") {
        alert("MetaMask is required.");
        return;
    }

    if (!confirm("Cancel this agreement?\n\nThe complete remaining escrow will be refunded to the Shipper.")) {
        return;
    }

    try {
        const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
        const account = accounts[0];

        const web3 = new Web3(window.ethereum);
        const contract = new web3.eth.Contract(CONTRACT_ABI, CONTRACT_ADDRESS);

        const tx = await contract.methods.cancelAgreement(Number(agreementId)).send({
            from: account
        });

        const targetAgreement = allAgreements.find(a => Number(a.agreement_id) === Number(agreementId));
        const refund = Number(targetAgreement?.escrow_remaining || targetAgreement?.escrow_amount || 0);

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

        await supabaseClient
            .from("transactions")
            .insert([{
                transaction_hash: tx.transactionHash,
                agreement_id: Number(agreementId),
                event_type: "AgreementCancelled",
                actor_address: account.toLowerCase(),
                details: {
                    status: "Cancelled",
                    escrow_refunded: refund,
                    description: "Agreement cancelled and escrow refunded to shipper."
                }
            }]);

        alert("Agreement cancelled successfully.\n\nThe escrow has been refunded to the Shipper.");
        window.location.reload();

    } catch (error) {
        console.error("Cancellation failed:", error);
        let message = error?.message || String(error);
        if (error?.code === 4001) {
            message = "Transaction was rejected in MetaMask.";
        }
        alert("Cancellation failed:\n\n" + message);
    }
}

// =====================================================
// EFFECTIVE STATUS
// =====================================================

function getEffectiveStatus(
    agreement
) {

    // -------------------------------------------------
    // Blockchain is authoritative
    // -------------------------------------------------

    const blockchainStatus =
        Number(
            agreement.blockchain_status
        );

    switch (
    blockchainStatus
    ) {

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
    }

    // -------------------------------------------------
    // Fallback deadline check
    // -------------------------------------------------

    const deadline =
        Number(
            agreement.blockchain_deadline ||
            agreement.deadline ||
            0
        );

    if (
        deadline &&
        Math.floor(
            Date.now() / 1000
        ) >
        deadline &&
        agreement.status !==
        "Completed" &&
        agreement.status !==
        "Cancelled"
    ) {

        return "Expired";
    }

    return (
        agreement.status ||
        "Created"
    );
}


// =====================================================
// VIEW AGREEMENT
// =====================================================

function viewAgreement(
    id
) {

    window.location.href =
        `agreementDetails.html?id=${Number(id)}`;
}


// =====================================================
// HELPERS
// =====================================================

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


function shortenAddress(
    address
) {

    if (!address ||
        address.trim() === "" ||
        address.toLowerCase() === "0x0000000000000000000000000000000000000000") {
        return '<span class="text-muted" style="font-style: italic;">Unassigned</span>';
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

        case "Cancelled":
            return "status-cancelled";

        case "Expired":
            return "status-expired";

        default:
            return "status-active";
    }
}


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


function showAgreementsError(
    message
) {

    const tbody =
        document.getElementById(
            "agreements-table-body"
        );

    if (!tbody) {
        return;
    }

    tbody.innerHTML = `
        <tr>
            <td
                colspan="9"
                style="
                    text-align:center;
                    color:#ef4444;
                    padding:30px;
                "
            >
                <i class="fa-solid fa-circle-exclamation"></i>
                ${escapeHtml(
        message
    )}
            </td>
        </tr>
    `;
}