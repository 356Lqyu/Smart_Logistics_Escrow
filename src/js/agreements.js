document.addEventListener(
    "DOMContentLoaded",
    async () => {

        const filterButtons =
            document.querySelectorAll(
                ".filter-btn"
            );

        filterButtons.forEach(btn => {
            btn.addEventListener(
                "click",
                () => {
                    filterButtons.forEach(
                        b =>
                            b.classList.remove(
                                "active"
                            )
                    );

                    btn.classList.add(
                        "active"
                    );

                    filterTableRows(
                        btn.getAttribute(
                            "data-filter"
                        )
                    );
                }
            );
        });

        const tableSearchInput =
            document.getElementById(
                "table-search-input"
            );

        if (tableSearchInput) {
            tableSearchInput.addEventListener(
                "input",
                event => {
                    const query =
                        event.target.value
                            .toLowerCase()
                            .trim();

                    document
                        .querySelectorAll(
                            "#agreements-table-body tr"
                        )
                        .forEach(row => {
                            row.style.display =
                                row.innerText
                                    .toLowerCase()
                                    .includes(query)
                                    ? ""
                                    : "none";
                        });
                }
            );
        }

        await loadAgreements();
    }
);

// =====================================================
// LOAD AGREEMENTS
// =====================================================

async function loadAgreements() {

    const tableBody =
        document.getElementById(
            "agreements-table-body"
        );

    if (!tableBody) {
        return;
    }

    tableBody.innerHTML = `
        <tr>
            <td colspan="9"
                style="text-align:center;color:#8d99ae;padding:30px;">
                <i class="fa-solid fa-spinner fa-spin"></i>
                Loading agreements...
            </td>
        </tr>
    `;

    try {

        const currentWallet =
            localStorage.getItem(
                "wallet"
            );

        const userRole =
            localStorage.getItem(
                "role"
            );

        let query =
            supabaseClient
                .from("agreements")
                .select(`
                    agreement_id,
                    reference_no,
                    shipper_address,
                    carrier_address,
                    shipment_details,
                    payload_value,
                    escrow_amount,
                    escrow_released,
                    escrow_remaining,
                    deadline,
                    created_time,
                    priority,
                    status,
                    current_milestone,
                    accepted_at,
                    completed_at,
                    cancelled_at,
                    expired_at,
                    refunded_amount
                `);

        if (currentWallet) {
            const walletLower = currentWallet.toLowerCase();

            if (userRole === "1" || userRole === "Shipper") {
                query = query.eq("shipper_address", walletLower);
            } else if (userRole === "2" || userRole === "Carrier") {
                // Fetch candidate rows (Created jobs or any assigned rows)
                query = query.or(`status.eq.Created,carrier_address.eq.${walletLower}`);
            }
        }

        const {
            data: rawAgreements,
            error
        } =
            await query.order(
                "agreement_id",
                {
                    ascending: false
                }
            );

        if (error) {
            throw error;
        }

        // Strict post-filtering to guarantee carriers ONLY see:
        // 1. Status 'Created'
        // 2. Status 'In Progress' where carrier_address exactly matches the logged-in wallet
        let agreements = rawAgreements;
        const roleStr = String(userRole || "").toLowerCase();
        const isCarrierUser = (roleStr === "2" || roleStr === "carrier");
        const isShipperUser = (roleStr === "1" || roleStr === "shipper");

        if (isShipperUser && currentWallet) {
            const walletLower = currentWallet.toLowerCase();
            agreements = (rawAgreements || []).filter(a => 
                a.shipper_address && a.shipper_address.toLowerCase() === walletLower
            );
        } else if (isCarrierUser && currentWallet) {
            const walletLower = currentWallet.toLowerCase();
            agreements = (rawAgreements || []).filter(a => {
                const status = String(a.status || "").toLowerCase();
                if (status === "created") {
                    return true;
                }
                if (status === "in progress") {
                    return a.carrier_address && a.carrier_address.toLowerCase() === walletLower;
                }
                // Optionally filter out other statuses if carriers shouldn't see them here, 
                // or keep them if you want completed/cancelled to show based on participation.
                return a.carrier_address && a.carrier_address.toLowerCase() === walletLower;
            });
        }

        if (
            !agreements ||
            agreements.length === 0
        ) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="9"
                        style="text-align:center;color:#8d99ae;padding:30px;">
                        No agreements found.
                    </td>
                </tr>
            `;
            return;
        }

        tableBody.innerHTML = "";


        agreements.forEach(
            rawData => {

                const statusText =
                    rawData.status ||
                    "Created";

                const isCreated =
                    statusText ===
                    "Created";

                const shipperAddr =
                    formatAddress(
                        rawData.shipper_address
                    );

                const carrierAddr =
                    rawData.carrier_address
                        ? formatAddress(
                            rawData.carrier_address
                        )
                        : "Unassigned";

                const escrowAmount =
                    Number(
                        rawData.escrow_amount ||
                        0
                    ).toFixed(3);

                const deadlineText =
                    formatTimestamp(
                        rawData.deadline
                    );

                const priority =
                    rawData.priority ||
                    "Normal";

                const payload =
                    rawData.shipment_details ||
                    `Shipment #${rawData.agreement_id}`;

                // =================================================
                // ACTION BUTTONS
                // =================================================

                let actionButtons = `
                    <button
                        class="view-btn"
                        onclick="viewAgreementDetails(${rawData.agreement_id})"
                    >
                        <i class="fa-regular fa-eye"></i>
                        View
                    </button>
                `;

                if (
                    isCarrierUser &&
                    isCreated
                ) {
                    actionButtons += `
                        <button
                            class="primary-action-btn"
                            style="
                                margin-left:5px;
                                padding:6px 10px;
                                font-size:11px;
                            "
                            onclick="acceptAgreementAction(${rawData.agreement_id})"
                        >
                            <i class="fa-solid fa-check"></i>
                            Accept
                        </button>
                    `;
                }

                const row =
                    document.createElement(
                        "tr"
                    );

                row.innerHTML = `
                    <td class="ref-col">
                        ${escapeHtml(
                    rawData.reference_no
                )}
                    </td>

                    <td>
                        ${shipperAddr}
                    </td>

                    <td>
                        ${carrierAddr ===
                        "Unassigned"
                        ? `
                                    <span class="text-muted">
                                        Unassigned
                                    </span>
                                  `
                        : carrierAddr
                    }
                    </td>

                    <td title="${escapeHtml(payload)}">
                        ${escapeHtml(payload)}
                    </td>

                    <td>
                        <span class="priority-badge">
                            ${escapeHtml(
                        priority
                    ).toUpperCase()}
                        </span>
                    </td>

                    <td class="eth-val">
                        <i class="fa-brands fa-ethereum"></i>
                        ${escrowAmount}
                    </td>

                    <td>
                        ${deadlineText}
                    </td>

                    <td>
                        <span class="status-badge ${getStatusClass(statusText)}">
                            <span class="status-dot"></span>
                            ${escapeHtml(statusText)}
                        </span>
                    </td>

                    <td>
                        ${actionButtons}
                    </td>
                `;

                tableBody.appendChild(
                    row
                );
            }
        );

    } catch (error) {

        console.error(
            "Failed to fetch agreements:",
            error
        );

        tableBody.innerHTML = `
            <tr>
                <td colspan="9"
                    style="text-align:center;color:#ef4444;padding:30px;">
                    Error loading agreements:
                    ${escapeHtml(
            error.message
        )}
                </td>
            </tr>
        `;
    }
}

// =====================================================
// CARRIER ACCEPT
// =====================================================

async function acceptAgreementAction(
    agreementId
) {

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

        const chainId =
            Number(
                await web3.eth.getChainId()
            );

        if (
            chainId !== 1337 &&
            chainId !== 5777
        ) {
            throw new Error(
                "Please connect MetaMask to Ganache."
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

        const {
            error:
            supabaseError
        } =
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
                    agreementId
                );

        if (supabaseError) {
            console.error(
                "Supabase acceptance update failed:",
                supabaseError
            );
        }

        await supabaseClient
            .from("transactions")
            .insert([{
                transaction_hash:
                    tx.transactionHash,

                agreement_id:
                    Number(agreementId),

                event_type:
                    "AgreementAccepted",

                actor_address:
                    currentAccount.toLowerCase(),

                details: {
                    status:
                        "In Progress",

                    description:
                        "Carrier accepted the logistics agreement."
                }
            }]);

        alert(
            "Agreement accepted successfully.\n\n" +
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
            error?.code === 4001
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
// STATUS
// =====================================================

function getStatusClass(status) {

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

// =====================================================
// ADDRESS
// =====================================================

function formatAddress(address) {

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
// DATE
// =====================================================

function formatTimestamp(timestamp) {

    if (!timestamp) {
        return "—";
    }

    const date =
        new Date(
            Number(timestamp) *
            1000
        );

    if (
        isNaN(
            date.getTime()
        )
    ) {
        return "—";
    }

    return date.toLocaleDateString(
        undefined,
        {
            year:
                "numeric",
            month:
                "short",
            day:
                "numeric"
        }
    );
}

// =====================================================
// FILTER
// =====================================================

function filterTableRows(
    filter
) {

    const wanted =
        (
            filter ||
            "all"
        )
            .toLowerCase();

    document
        .querySelectorAll(
            "#agreements-table-body tr"
        )
        .forEach(row => {

            const badge =
                row.querySelector(
                    ".status-badge"
                );

            if (!badge) {
                return;
            }

            const status =
                badge.innerText
                    .trim()
                    .toLowerCase();

            if (
                wanted ===
                "all"
            ) {
                row.style.display =
                    "";
            }
            else if (
                wanted ===
                "available"
            ) {
                row.style.display =
                    status ===
                        "created"
                        ? ""
                        : "none";
            }
            else if (
                wanted ===
                "active"
            ) {
                row.style.display =
                    status ===
                        "in progress"
                        ? ""
                        : "none";
            }
            else {
                row.style.display =
                    status ===
                        wanted
                        ? ""
                        : "none";
            }
        });
}

// =====================================================
// VIEW
// =====================================================

function viewAgreementDetails(
    agreementId
) {
    window.location.href =
        `agreementDetails.html?id=${agreementId}`;
}

// =====================================================
// ESCAPE
// =====================================================

function escapeHtml(value) {

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
