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
// LOAD TRANSACTION HISTORY
// =====================================================

async function loadTransactionHistory() {

    showLoading();


    // =================================================
    // 1. LOAD USER AGREEMENTS
    // =================================================

    const {
        data: agreements,
        error: agreementError
    } = await supabaseClient
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
        `)
        .or(
            `shipper_address.eq.${currentAccount},carrier_address.eq.${currentAccount}`
        )
        .order(
            "agreement_id",
            {
                ascending: false
            }
        );


    if (agreementError) {

        throw agreementError;

    }


    allAgreements =
        agreements || [];


    console.log(
        "User agreements:",
        allAgreements
    );


    // =================================================
    // 2. GET AGREEMENT IDS
    // =================================================

    const agreementIds =
        allAgreements.map(
            agreement =>
                agreement.agreement_id
        );


    // =================================================
    // 3. LOAD TRANSACTIONS
    // =================================================

    if (
        agreementIds.length > 0
    ) {

        const {
            data: transactions,
            error: transactionError
        } = await supabaseClient
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
            .in(
                "agreement_id",
                agreementIds
            )
            .order(
                "created_at",
                {
                    ascending: false
                }
            );


        if (transactionError) {

            throw transactionError;

        }


        allTransactions =
            transactions || [];

    }
    else {

        allTransactions = [];

    }


    // =================================================
    // 4. LOAD MILESTONES
    // =================================================

    if (
        agreementIds.length > 0
    ) {

        const {
            data: milestones,
            error: milestoneError
        } = await supabaseClient
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
            .in(
                "agreement_id",
                agreementIds
            )
            .order(
                "milestone_index",
                {
                    ascending: true
                }
            );


        if (milestoneError) {

            throw milestoneError;

        }


        allMilestones =
            milestones || [];

    }
    else {

        allMilestones = [];

    }


    // =================================================
    // 5. UPDATE STATISTICS
    // =================================================

    updateStatistics();


    // =================================================
    // 6. DISPLAY LEDGER
    // =================================================

    renderLedger();

}


// =====================================================
// UPDATE STATISTICS
// =====================================================

function updateStatistics() {


    // =================================================
    // CURRENT ESCROW BALANCE
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
    // RELEASED ETH
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


    if (earnedElement) {

        earnedElement.innerText =
            released.toFixed(3);

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
    // REFUNDED AGREEMENTS
    // =================================================

    const refunded =
        allAgreements.filter(
            agreement =>
                agreement.status ===
                "Refunded"
        ).length;


    const refundElement =
        document.getElementById(
            "refund-count"
        );


    if (refundElement) {

        refundElement.innerText =
            refunded;

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
    // MILESTONE EVENTS
    // =================================================

    allMilestones.forEach(
        milestone => {

            const agreement =
                findAgreement(
                    milestone.agreement_id
                );


            // -----------------------------------------
            // COMPLETED
            // -----------------------------------------

            if (
                milestone.completed &&
                milestone.completed_at
            ) {

                events.push({

                    type:
                        "milestone",

                    date:
                        milestone.completed_at,

                    agreement:
                        agreement,

                    transaction:
                        null,

                    milestone:
                        milestone,

                    milestoneAction:
                        "Completed"

                });

            }


            // -----------------------------------------
            // VERIFIED
            // -----------------------------------------

            if (
                milestone.verified &&
                milestone.verified_at
            ) {

                events.push({

                    type:
                        "milestone",

                    date:
                        milestone.verified_at,

                    agreement:
                        agreement,

                    transaction:
                        null,

                    milestone:
                        milestone,

                    milestoneAction:
                        "Verified"

                });

            }

        }
    );

    // =================================================
    // 3. CANCELLED AGREEMENTS
    // =================================================

    allAgreements.forEach(
        agreement => {

            if (
                agreement.status &&
                String(
                    agreement.status
                ).toLowerCase() === "cancelled"
            ) {

                // Only create cancellation event
                // if there is no transaction event
                // already representing cancellation.

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

function renderTransactionRow(
    row,
    event
) {

    const transaction =
        event.transaction;

    const agreement =
        event.agreement;


    const date =
        formatDateTime(
            transaction.created_at
        );


    const reference =
        agreement
            ? agreement.reference_no
            : `Agreement #${transaction.agreement_id}`;


    const type =
        transaction.event_type ||
        "Transaction";


    const amount =
        extractTransactionAmount(
            transaction
        );


    const status =
        getTransactionStatus(
            type
        );


    row.innerHTML = `

        <td>

            ${escapeHtml(date)}

        </td>


        <td>

            <strong>
                ${escapeHtml(reference)}
            </strong>

        </td>


        <td>

            <span class="transaction-type-badge">

                ${escapeHtml(type)}

            </span>

        </td>


        <td>

            ${escapeHtml(amount)}

        </td>


        <td>

            ${transaction.transaction_hash
            ? `
                        <a
                            href="${buildExplorerUrl(
                transaction.transaction_hash
            )}"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="transaction-hash"
                            title="${escapeHtml(
                transaction.transaction_hash
            )}"
                        >
                            ${formatHash(
                transaction.transaction_hash
            )}
                        </a>
                    `
            : "—"
        }

        </td>


        <td>

            <span
                class="transaction-status ${getStatusClass(
            status
        )}"
            >

                ${escapeHtml(status)}

            </span>

        </td>

    `;

}


// =====================================================
// MILESTONE ROW
// =====================================================

function renderMilestoneRow(
    row,
    event
) {

    const milestone =
        event.milestone;

    const agreement =
        event.agreement;


    const reference =
        agreement
            ? agreement.reference_no
            : `Agreement #${milestone.agreement_id}`;


    const date =
        formatDateTime(
            event.date
        );


    const action =
        event.milestoneAction;


    row.innerHTML = `

        <td>

            ${escapeHtml(date)}

        </td>


        <td>

            <strong>
                ${escapeHtml(reference)}
            </strong>

        </td>


        <td>

            <span class="transaction-type-badge">

                Milestone ${escapeHtml(
        String(
            milestone.milestone_index + 1
        )
    )}

            </span>

        </td>


        <td>

            ${escapeHtml(
        milestone.percentage
    )}%

        </td>


        <td>

            —

        </td>


        <td>

            <span
                class="transaction-status status-completed"
            >

                ${escapeHtml(
        action
    )}

            </span>

        </td>

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
// EXTRACT TRANSACTION AMOUNT
// =====================================================

function extractTransactionAmount(transaction) {
    const details = transaction.details;
    const eventType = transaction.event_type;

    if (!details) {
        return "—";
    }

    if (typeof details === "object") {
        let amount = null;
        let isIncoming = false; // false means outgoing (-), true means incoming (+)

        if (details.escrow && details.escrow.amount !== undefined) {
            amount = Number(details.escrow.amount);
            isIncoming = false; // Funding escrow is money out
        } else if (details.escrow_amount !== undefined) {
            amount = Number(details.escrow_amount);
            isIncoming = false;
        } else if (details.escrow_refunded !== undefined) {
            amount = Number(details.escrow_refunded);
            isIncoming = true; // Refund is money back in
        } else if (eventType === "MilestonePaid" || eventType === "MilestonePayout") {
            amount = Number(details.amount || 0);
            isIncoming = true; // Carrier receiving payout is money in
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
            "release"
        )
    ) {

        return "Released";

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

        case "Completed":
            return "status-completed";

        case "Refunded":
            return "status-refunded";

        case "Cancelled":
            return "status-cancelled";

        case "Expired":
            return "status-expired";

        case "Released":
            return "status-released";

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


    /*
     * Ganache normally does not have a public Etherscan transaction page.
     *
     * Therefore return "#" for local development.
     *
     * If use Sepolia later, change this to:
     * https://sepolia.etherscan.io/tx/
     */

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