// =====================================================
// GLOBAL STATE
// =====================================================
let allTransactions = [];
let allMilestones = [];
let allAgreements = [];
let currentFilter = "all";

// =====================================================
// PAGE INITIALIZATION
// =====================================================

document.addEventListener(
    "DOMContentLoaded",
    async () => {

        console.log(
            "Initializing Transaction History..."
        );

        try {

            // =========================================
            // 1. INITIALIZE WALLET FIRST
            // =========================================

            await initializeWallet();


            // =========================================
            // 2. LOAD TRANSACTION HISTORY
            // =========================================

            await loadTransactionHistory();


            // =========================================
            // 3. INITIALIZE UI
            // =========================================

            initializeSearch();

            initializeFilters();


            console.log(
                "Transaction History initialized successfully."
            );

        }
        catch (error) {

            console.error(
                "Transaction History initialization failed:",
                error
            );

            showError(
                error.message
            );

        }

    }
);

// =====================================================
// INITIALIZE WALLET
// =====================================================

async function initializeWallet() {

    // =========================================
    // CHECK METAMASK
    // =========================================

    if (typeof window.ethereum === "undefined") {

        throw new Error(
            "MetaMask is required."
        );

    }


    // =========================================
    // GET CONNECTED ACCOUNT
    // =========================================

    const accounts =
        await window.ethereum.request({
            method: "eth_accounts"
        });


    if (
        !accounts ||
        accounts.length === 0
    ) {

        throw new Error(
            "No MetaMask account connected."
        );

    }


    // =========================================
    // NORMALIZE ADDRESS
    // =========================================

    currentAccount =
        accounts[0].toLowerCase();


    // =========================================
    // SAVE CONSISTENTLY
    // =========================================

    localStorage.setItem(
        "wallet",
        currentAccount
    );


    console.log(
        "Transaction History wallet:",
        currentAccount
    );


    // =========================================
    // DISPLAY WALLET
    // =========================================

    updateWalletDisplay(
        currentAccount
    );

}


// =====================================================
// UPDATE WALLET DISPLAY
// =====================================================

function updateWalletDisplay(address) {

    const walletElement =
        document.getElementById(
            "top-wallet-address"
        );


    if (!walletElement) {
        return;
    }


    walletElement.innerText =
        formatAddress(address);

}

// =====================================================
// LOAD TRANSACTION HISTORY (STRICTLY ROLE-AWARE)
// =====================================================

async function loadTransactionHistory() {

    showLoading();

    const userRole = String(localStorage.getItem("role") || "").toLowerCase();
    const isCarrier = (userRole === "2" || userRole === "carrier");

    // 1. LOAD AGREEMENTS WHERE THE USER IS INVOLVED
    let agreementQuery = supabaseClient
        .from("agreements")
        .select(`
            agreement_id,
            reference_no,
            shipper_address,
            carrier_address,
            escrow_amount,
            escrow_released,
            escrow_remaining,
            status,
            current_milestone,
            created_time,
            accepted_at,
            completed_at,
            cancelled_at,
            expired_at,
            deadline
        `);

    if (isCarrier) {
        agreementQuery = agreementQuery.eq("carrier_address", currentAccount);
    } else {
        agreementQuery = agreementQuery.eq("shipper_address", currentAccount);
    }

    const { data: agreements, error: agreementError } = await agreementQuery.order("agreement_id", { ascending: false });

    if (agreementError) {
        throw agreementError;
    }

    allAgreements = agreements || [];
    const agreementIds = allAgreements.map(agreement => agreement.agreement_id);

    // 2. LOAD TRANSACTIONS STRICTLY BOUND TO USER ROLE & AGREEMENTS
    if (agreementIds.length > 0) {
        let txQuery = supabaseClient
            .from("transactions")
            .select(`
                id,
                transaction_hash,
                agreement_id,
                event_type,
                actor_address,
                details,
                created_at
            `)
            .in("agreement_id", agreementIds);

        // If user is a carrier, only pull transactions where they performed the action.
        // If user is a shipper, pull transactions for their agreements where they are the actor or relevant creator.
        if (isCarrier) {
            // Carriers see their own performed actions OR payout/release transactions
            txQuery = txQuery.or(`actor_address.eq.${currentAccount},event_type.eq.MilestonePayout,event_type.eq.MilestoneVerified`);
        } else {
            txQuery = txQuery.eq("actor_address", currentAccount);
        }

        const { data: transactions, error: transactionError } = await txQuery.order("created_at", { ascending: false });

        if (transactionError) {
            throw transactionError;
        }

        allTransactions = transactions || [];
    } else {
        allTransactions = [];
    }

    // 3. LOAD MILESTONES FOR THESE AGREEMENTS
    if (agreementIds.length > 0) {
        const { data: milestones, error: milestoneError } = await supabaseClient
            .from("milestones")
            .select(`
                id,
                agreement_id,
                milestone_index,
                checkpoint,
                percentage,
                completed,
                verified,
                completed_at,
                verified_at
            `)
            .in("agreement_id", agreementIds)
            .order("milestone_index", { ascending: true });

        if (milestoneError) {
            throw milestoneError;
        }

        allMilestones = milestones || [];
    } else {
        allMilestones = [];
    }

    updateStatistics();
    renderLedger();
}


// =====================================================
// UPDATE STATISTICS (ROLE-AWARE)
// =====================================================

function updateStatistics() {
    const userRole = String(localStorage.getItem("role") || "").toLowerCase();
    const isCarrier = (userRole === "2" || userRole === "carrier");

    // =================================================
    // CURRENT ESCROW BALANCE / STAKE
    // =================================================

    const escrowBalance =
        allAgreements.reduce(
            (total, agreement) => {

                const status =
                    String(
                        agreement.status || ""
                    ).toLowerCase();

                if (
                    status !== "created" &&
                    status !== "in progress"
                ) {
                    return total;
                }

                return (
                    total +
                    Number(
                        agreement.escrow_remaining || 0
                    )
                );

            },
            0
        );


    const escrowElement =
        document.getElementById(
            "escrow-balance"
        );


    if (escrowElement) {

        escrowElement.innerText =
            escrowBalance.toFixed(3);

    }


    // =================================================
    // RELEASED ETH (SPENT VS EARNED)
    // =================================================

    const released =
        allAgreements.reduce(
            (
                total,
                agreement
            ) => {

                return (
                    total +
                    Number(
                        agreement.escrow_released || 0
                    )
                );

            },
            0
        );


    const earnedElement =
        document.getElementById(
            "eth-earned"
        );

    const earnedLabel = 
        earnedElement 
            ? earnedElement.closest(".transaction-stat-card")?.querySelector(".stat-label") 
            : null;


    if (earnedElement) {

        earnedElement.innerText =
            released.toFixed(3);

        if (isCarrier && earnedLabel) {
            earnedLabel.innerText = "ETH EARNED";
        }

    }


    // =================================================
    // COMPLETED AGREEMENTS
    // =================================================

    const completed =
        allAgreements.filter(
            agreement =>
                agreement.status ===
                "Completed"
        ).length;


    const completedElement =
        document.getElementById(
            "completed-count"
        );


    if (completedElement) {

        completedElement.innerText =
            completed;

    }


    // =================================================
    // REFUNDED / CANCELLED AGREEMENTS
    // =================================================

    const refunded =
        allAgreements.filter(
            agreement =>
                agreement.status === "Refunded" || 
                agreement.status === "Cancelled" || 
                agreement.status === "Expired"
        ).length;


    const refundElement =
        document.getElementById(
            "refund-count"
        );

    const refundLabel = 
        refundElement 
            ? refundElement.closest(".transaction-stat-card")?.querySelector(".stat-label") 
            : null;


    if (refundElement) {

        refundElement.innerText =
            refunded;

        if (refundLabel) {
            refundLabel.innerText = "REFUNDED / CANCELLED";
        }

    }

}


// =====================================================
// BUILD LEDGER
// =====================================================

function buildLedgerEvents() {

    const events = [];


    // =================================================
    // TRANSACTIONS
    // =================================================

    allTransactions.forEach(
        transaction => {

            const agreement =
                findAgreement(
                    transaction.agreement_id
                );


            events.push({

                type:
                    "transaction",

                date:
                    transaction.created_at,

                agreement:
                    agreement,

                transaction:
                    transaction,

                milestone:
                    null

            });

        }
    );

    // =================================================
    // 2. CANCELLED AGREEMENTS
    // =================================================

    allAgreements.forEach(
        agreement => {

            if (
                agreement.status &&
                String(
                    agreement.status
                ).toLowerCase() === "cancelled"
            ) {

                const hasCancellationTransaction =
                    allTransactions.some(
                        transaction => {

                            return (
                                Number(
                                    transaction.agreement_id
                                ) ===
                                Number(
                                    agreement.agreement_id
                                ) &&

                                String(
                                    transaction.event_type || ""
                                )
                                    .toLowerCase()
                                    .includes(
                                        "cancel"
                                    )
                            );

                        }
                    );


                if (
                    !hasCancellationTransaction
                ) {

                    events.push({

                        type:
                            "agreement",

                        date:
                            agreement.cancelled_at ||
                            agreement.created_time,

                        agreement:
                            agreement,

                        transaction:
                            null,

                        milestone:
                            null,

                        agreementAction:
                            "Cancelled"

                    });

                }

            }

        }
    );


    // =================================================
    // SORT 
    // =================================================

    events.sort(
        (
            a,
            b
        ) => {

            const dateA =
                new Date(
                    a.date || 0
                ).getTime();

            const dateB =
                new Date(
                    b.date || 0
                ).getTime();

            return dateB - dateA;

        }
    );


    return events;

}


// =====================================================
// RENDER LEDGER
// =====================================================

function renderLedger() {

    const tableBody =
        document.getElementById(
            "transaction-table-body"
        );


    if (!tableBody) {
        return;
    }


    const events =
        buildLedgerEvents();


    // =================================================
    // FILTER
    // =================================================

    const filteredEvents =
        events.filter(
            event =>
                matchesFilter(
                    event
                )
        );


    // =================================================
    // EMPTY
    // =================================================

    if (
        filteredEvents.length === 0
    ) {

        tableBody.innerHTML = `

            <tr>

                <td
                    colspan="6"
                    style="
                        text-align:center;
                        padding:40px;
                        color:#8d99ae;
                    "
                >

                    <i
                        class="fa-solid fa-clock-rotate-left"
                        style="
                            font-size:28px;
                            margin-bottom:12px;
                        "
                    ></i>

                    <br>

                    No transaction history found.

                </td>

            </tr>

        `;

        return;

    }


    // =================================================
    // CREATE ROWS
    // =================================================

    tableBody.innerHTML = "";


    filteredEvents.forEach(
        event => {

            const row =
                document.createElement(
                    "tr"
                );


            if (
                event.type ===
                "transaction"
            ) {

                renderTransactionRow(
                    row,
                    event
                );

            }
            else {

                renderMilestoneRow(
                    row,
                    event
                );

            }


            tableBody.appendChild(
                row
            );

        }
    );

}


// =====================================================
// TRANSACTION ROW
// =====================================================

function renderTransactionRow(row, event) {
    const transaction = event.transaction;
    const agreement = event.agreement;

    const date = formatDateTime(transaction.created_at);
    const reference = agreement ? agreement.reference_no : `Agreement #${transaction.agreement_id}`;
    
    let type = transaction.event_type || "Transaction";
    const amount = extractTransactionAmount(transaction, agreement);
    const status = getTransactionStatus(type);

    // Extract milestone index / checkpoint info from transaction details if available
    let detailsText = "—";
    if (transaction.details) {
        if (typeof transaction.details === "object") {
            detailsText = transaction.details.description || transaction.details.status || JSON.stringify(transaction.details);
            
            // If a milestone index exists in details, append it cleanly to the type name
            if (transaction.details.milestone_index !== undefined) {
                const milestoneNum = Number(transaction.details.milestone_index) + 1;
                type = `${type} (M${milestoneNum})`;
            }
        } else {
            detailsText = String(transaction.details);
        }
    }

    row.innerHTML = `
        <td>${escapeHtml(date)}</td>
        <td><strong>${escapeHtml(reference)}</strong></td>
        <td><span class="transaction-type-badge">${escapeHtml(type)}</span></td>
        <td>${escapeHtml(amount)}</td>
        <td style="color: #8d99ae; max-width: 250px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(detailsText)}">
            ${escapeHtml(detailsText)}
        </td>
        <td>
            ${transaction.transaction_hash ? `
                <a href="${buildExplorerUrl(transaction.transaction_hash)}" target="_blank" rel="noopener noreferrer" class="transaction-hash" title="${escapeHtml(transaction.transaction_hash)}">
                    ${formatHash(transaction.transaction_hash)}
                </a>
            ` : "—"}
        </td>
        <td><span class="transaction-status ${getStatusClass(status)}">${escapeHtml(status)}</span></td>
    `;
}


// =====================================================
// MILESTONE ROW
// =====================================================

function renderMilestoneRow(row, event) {
    const milestone = event.milestone;
    const agreement = event.agreement;

    const reference = agreement ? agreement.reference_no : `Agreement #${milestone.agreement_id}`;
    const date = formatDateTime(event.date);
    const action = event.milestoneAction;
    
    let detailsText = `Milestone ${milestone.milestone_index + 1}: ${milestone.checkpoint}`;

    row.innerHTML = `
        <td>${escapeHtml(date)}</td>
        <td><strong>${escapeHtml(reference)}</strong></td>
        <td><span class="transaction-type-badge">Milestone ${escapeHtml(String(milestone.milestone_index + 1))}</span></td>
        <td>${escapeHtml(milestone.percentage)}%</td>
        <td style="color: #8d99ae;">${escapeHtml(detailsText)}</td>
        <td>—</td>
        <td><span class="transaction-status status-completed">${escapeHtml(action)}</span></td>
    `;
}


// =====================================================
// MATCH FILTER
// =====================================================

function matchesFilter(event) {

    if (
        currentFilter ===
        "all"
    ) {

        return true;

    }


    const type =
        event.type ===
            "milestone"

            ? "completed"

            : (
                event.transaction
                    ?.event_type || ""
            ).toLowerCase();


    const agreement =
        event.agreement;


    if (
        currentFilter ===
        "completed"
    ) {

        return (
            type.includes(
                "completed"
            ) ||
            agreement?.status ===
            "Completed"
        );

    }


    if (
        currentFilter ===
        "funded"
    ) {

        return (
            type.includes(
                "fund"
            ) ||
            type.includes(
                "created"
            )
        );

    }


    if (
        currentFilter ===
        "refunded"
    ) {

        return (
            type.includes(
                "refund"
            ) ||
            agreement?.status ===
            "Refunded"
        );

    }

    if (
        currentFilter === "cancelled"
    ) {

        return (
            type.includes("cancel") ||
            event.agreementAction === "Cancelled"
        );

    }


    return true;

}


// =====================================================
// SEARCH
// =====================================================

function initializeSearch() {

    const searchInput =
        document.getElementById(
            "agreement-search"
        );


    if (!searchInput) {
        return;
    }


    searchInput.addEventListener(
        "input",
        () => {

            const query =
                searchInput.value
                    .toLowerCase()
                    .trim();


            const rows =
                document.querySelectorAll(
                    "#transaction-table-body tr"
                );


            rows.forEach(
                row => {

                    const text =
                        row.innerText
                            .toLowerCase();


                    row.style.display =
                        text.includes(query)
                            ? ""
                            : "none";

                }
            );

        }
    );

}


// =====================================================
// FILTER BUTTONS
// =====================================================

function initializeFilters() {

    const buttons =
        document.querySelectorAll(
            ".transaction-filter-btn"
        );


    buttons.forEach(
        button => {

            button.addEventListener(
                "click",
                () => {

                    buttons.forEach(
                        b =>
                            b.classList.remove(
                                "active"
                            )
                    );


                    button.classList.add(
                        "active"
                    );


                    currentFilter =
                        button.getAttribute(
                            "data-filter"
                        ) ||
                        "all";


                    renderLedger();

                }
            );

        }
    );

}


// =====================================================
// FIND AGREEMENT
// =====================================================

function findAgreement(
    agreementId
) {

    return allAgreements.find(
        agreement =>
            Number(
                agreement.agreement_id
            ) ===
            Number(
                agreementId
            )
    );

}


// =====================================================
// EXTRACT TRANSACTION AMOUNT (ROLE-AWARE)
// =====================================================

function extractTransactionAmount(transaction, agreement = null) {
    const details = transaction.details;
    const eventType = transaction.event_type;

    if (!details) {
        return "—";
    }

    if (typeof details === "object") {
        let amount = null;
        let isIncoming = false; 

        if (details.escrow && details.escrow.amount !== undefined) {
            amount = Number(details.escrow.amount);
            isIncoming = false; 
        } else if (details.escrow_amount !== undefined) {
            amount = Number(details.escrow_amount);
            isIncoming = false;
        } else if (details.escrow_refunded !== undefined) {
            amount = Number(details.escrow_refunded);
            isIncoming = true; 

            // Older expiry records stored 0 after the balance had already
            // been cleared. Reconstruct the remaining escrow for display.
            if (
                eventType === "AgreementExpired" &&
                amount === 0 &&
                agreement
            ) {
                amount = Math.max(
                    0,
                    Number(agreement.escrow_amount || 0) -
                    Number(agreement.escrow_released || 0)
                );
            }
        } else if (
            eventType === "MilestonePaid" ||
            eventType === "MilestonePayout" ||
            eventType === "MilestoneVerified"
        ) {
            amount = Number(details.amount || 0);
            const userRole = String(localStorage.getItem("role") || "").toLowerCase();
            isIncoming = userRole === "carrier" || userRole === "2";
        }

        if (amount !== null && !isNaN(amount)) {
            const formatted = amount.toFixed(3);
            return isIncoming ? `+ ${formatted}` : `- ${formatted}`;
        }
    }

    return "—";
}


// =====================================================
// TRANSACTION STATUS
// =====================================================

function getTransactionStatus(
    eventType
) {

    const type =
        String(
            eventType
        ).toLowerCase();


    if (
        type.includes(
            "refund"
        )
    ) {

        return "Refunded";

    }


    if (
        type.includes(
            "complete"
        )
    ) {

        return "Completed";

    }


    if (
        type.includes(
            "cancel"
        )
    ) {

        return "Cancelled";

    }


    if (
        type.includes(
            "expire"
        )
    ) {

        return "Expired";

    }


    if (
        type.includes(
            "fund"
        ) ||
        type.includes(
            "created"
        )
    ) {

        return "Funded";

    }


    if (
        type.includes(
            "submit"
        )
    ) {

        return "Submitted";

    }


    if (
        type.includes(
            "verified"
        ) ||
        type.includes(
            "payout"
        ) ||
        type.includes(
            "release"
        )
    ) {

        return "Verified";

    }


    return "Recorded";

}


// =====================================================
// STATUS CSS CLASS
// =====================================================

function getStatusClass(
    status
) {

    switch (
    status
    ) {

        case "Funded":
            return "status-funded";

        case "Submitted":
            return "status-submitted";

        case "Verified":
        case "Released":
            return "status-verified";

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
// FORMAT DATE/TIME
// =====================================================

function formatDateTime(
    value
) {

    if (!value) {
        return "—";
    }


    const date =
        new Date(
            value
        );


    if (
        isNaN(
            date.getTime()
        )
    ) {

        return "—";

    }


    return date.toLocaleString(
        undefined,
        {
            year:
                "numeric",

            month:
                "short",

            day:
                "numeric",

            hour:
                "2-digit",

            minute:
                "2-digit"
        }
    );

}


// =====================================================
// FORMAT WALLET ADDRESS
// =====================================================

function formatAddress(
    address
) {

    if (!address) {
        return "Unknown";
    }


    if (
        address.length < 12
    ) {

        return escapeHtml(
            address
        );

    }


    return (
        escapeHtml(
            address.substring(
                0,
                6
            )
        ) +
        "..." +
        escapeHtml(
            address.substring(
                address.length - 4
            )
        )
    );

}


// =====================================================
// FORMAT TRANSACTION HASH
// =====================================================

function formatHash(
    hash
) {

    if (!hash) {
        return "—";
    }


    if (
        hash.length < 14
    ) {

        return escapeHtml(
            hash
        );

    }


    return (
        escapeHtml(
            hash.substring(
                0,
                8
            )
        ) +
        "..." +
        escapeHtml(
            hash.substring(
                hash.length - 6
            )
        )
    );

}


// =====================================================
// BLOCKCHAIN EXPLORER
// =====================================================

function buildExplorerUrl(
    hash
) {

    if (!hash) {
        return "#";
    }

    return "#";

}


// =====================================================
// LOADING
// =====================================================

function showLoading() {

    const tableBody =
        document.getElementById(
            "transaction-table-body"
        );


    if (!tableBody) {
        return;
    }


    tableBody.innerHTML = `

        <tr>

            <td
                colspan="6"
                style="
                    text-align:center;
                    padding:40px;
                    color:#8d99ae;
                "
            >

                <i
                    class="fa-solid fa-spinner fa-spin"
                ></i>

                Loading transaction history...

            </td>

        </tr>

    `;

}


// =====================================================
// ERROR
// =====================================================

function showError(
    message
) {

    const tableBody =
        document.getElementById(
            "transaction-table-body"
        );


    if (!tableBody) {
        return;
    }


    tableBody.innerHTML = `

        <tr>

            <td
                colspan="6"
                style="
                    text-align:center;
                    padding:40px;
                    color:#ef4444;
                "
            >

                <i
                    class="fa-solid fa-triangle-exclamation"
                ></i>

                <br><br>

                ${escapeHtml(
        message
    )}

            </td>

        </tr>

    `;

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
