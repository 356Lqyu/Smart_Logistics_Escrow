document.addEventListener("DOMContentLoaded", async () => {

    // =====================================================
    // FILTER BUTTONS
    // =====================================================

    const filterButtons =
        document.querySelectorAll(".filter-btn");

    filterButtons.forEach(btn => {

        btn.addEventListener("click", () => {

            filterButtons.forEach(b =>
                b.classList.remove("active")
            );

            btn.classList.add("active");

            filterTableRows(
                btn.getAttribute("data-filter")
            );

        });

    });


    // =====================================================
    // TABLE SEARCH
    // =====================================================

    const tableSearchInput =
        document.getElementById("table-search-input");

    if (tableSearchInput) {

        tableSearchInput.addEventListener(
            "input",
            event => {

                const query =
                    event.target.value
                        .toLowerCase()
                        .trim();

                const rows =
                    document.querySelectorAll(
                        "#agreements-table-body tr"
                    );

                rows.forEach(row => {

                    const text =
                        row.innerText.toLowerCase();

                    row.style.display =
                        text.includes(query)
                            ? ""
                            : "none";

                });

            }
        );

    }


    // =====================================================
    // LOAD AGREEMENTS
    // =====================================================

    await loadAgreements();

});


// =====================================================
// LOAD AGREEMENTS FROM SUPABASE
// =====================================================

async function loadAgreements() {

    const tableBody =
        document.getElementById(
            "agreements-table-body"
        );

    tableBody.innerHTML = `
        <tr>
            <td colspan="9"
                style="
                    text-align:center;
                    color:#8d99ae;
                    padding:30px;
                ">
                <i class="fa-solid fa-spinner fa-spin"></i>
                Loading agreements...
            </td>
        </tr>
    `;


    try {

        const {
            data: agreements,
            error
        } = await supabaseClient
            .from("agreements")
            .select(`
                agreement_id,
                reference_no,
                shipper_address,
                carrier_address,
                shipment_details,
                payload_value,
                escrow_amount,
                deadline,
                created_time,
                priority,
                status,
                current_milestone,
                accepted_at,
                completed_at,
                cancelled_at,
                expired_at,
                refunded_amount,
                escrow_released,
                escrow_remaining
            `)
            .order(
                "agreement_id",
                {
                    ascending: false
                }
            );


        if (error) {
            throw error;
        }


        // =================================================
        // NO DATA
        // =================================================

        if (
            !agreements ||
            agreements.length === 0
        ) {

            tableBody.innerHTML = `
                <tr>
                    <td colspan="9"
                        style="
                            text-align:center;
                            color:#8d99ae;
                            padding:30px;
                        ">
                        No agreements found.
                    </td>
                </tr>
            `;

            return;
        }


        tableBody.innerHTML = "";


        // =================================================
        // CREATE TABLE ROWS
        // =================================================

        agreements.forEach(rawData => {

            const statusText =
                rawData.status || "Created";


            // ---------------------------------------------
            // ADDRESS
            // ---------------------------------------------

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


            // ---------------------------------------------
            // STATUS
            // ---------------------------------------------

            const statusClass =
                getStatusClass(
                    statusText
                );


            // ---------------------------------------------
            // DEADLINE
            // ---------------------------------------------

            const deadlineText =
                formatTimestamp(
                    rawData.deadline
                );


            // ---------------------------------------------
            // ESCROW
            // ---------------------------------------------

            const escrowAmount =
                Number(
                    rawData.escrow_amount || 0
                ).toFixed(3);


            // ---------------------------------------------
            // PRIORITY
            // ---------------------------------------------

            const priority =
                rawData.priority || "Normal";


            // ---------------------------------------------
            // PAYLOAD
            // ---------------------------------------------

            const payload =
                rawData.shipment_details ||
                `Shipment #${rawData.agreement_id}`;


            // ---------------------------------------------
            // CREATE ROW
            // ---------------------------------------------

            const row =
                document.createElement("tr");


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
                    ${
                        carrierAddr === "Unassigned"

                        ? `
                            <span class="text-muted">
                                Unassigned
                            </span>
                          `

                        : carrierAddr
                    }
                </td>


                <td
                    title="${escapeHtml(payload)}"
                >
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
                    <span
                        class="status-badge ${statusClass}"
                    >
                        <span class="status-dot"></span>

                        ${escapeHtml(
                            statusText
                        )}
                    </span>
                </td>


                <td>

                    <button
                        class="view-btn"
                        onclick="
                            viewAgreementDetails(
                                ${rawData.agreement_id}
                            )
                        "
                    >
                        <i class="fa-regular fa-eye"></i>
                        View
                    </button>

                </td>

            `;


            tableBody.appendChild(row);

        });


    } catch (error) {

        console.error(
            "Failed to fetch agreements:",
            error
        );


        tableBody.innerHTML = `
            <tr>
                <td colspan="9"
                    style="
                        text-align:center;
                        color:#ef4444;
                        padding:30px;
                    ">

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
// STATUS CSS CLASS
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
            return "status-available";
    }

}


// =====================================================
// FORMAT ADDRESS
// =====================================================

function formatAddress(address) {

    if (!address) {
        return "Unknown";
    }


    if (address.length < 12) {
        return escapeHtml(address);
    }


    return (
        escapeHtml(
            address.substring(0, 6)
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
// FORMAT TIMESTAMP
// =====================================================

function formatTimestamp(timestamp) {

    if (!timestamp) {
        return "—";
    }


    const date =
        new Date(
            Number(timestamp) * 1000
        );


    if (isNaN(date.getTime())) {
        return "—";
    }


    return date.toLocaleDateString(
        undefined,
        {
            year: "numeric",
            month: "short",
            day: "numeric"
        }
    );

}


// =====================================================
// FILTER TABLE
// =====================================================

function filterTableRows(filter) {

    const rows =
        document.querySelectorAll(
            "#agreements-table-body tr"
        );


    rows.forEach(row => {

        // Ignore empty/error rows
        if (
            !row.querySelector(".status-badge")
        ) {
            return;
        }


        const status =
            row.querySelector(
                ".status-badge"
            )?.innerText
                .trim()
                .toLowerCase();


        const wanted =
            filter.toLowerCase();


        // =============================================
        // ALL
        // =============================================

        if (wanted === "all") {

            row.style.display = "";

            return;
        }


        // =============================================
        // AVAILABLE = CREATED
        // =============================================

        if (wanted === "available") {

            row.style.display =
                status === "created"
                    ? ""
                    : "none";

            return;
        }


        // =============================================
        // ACTIVE = IN PROGRESS
        // =============================================

        if (wanted === "active") {

            row.style.display =
                status === "in progress"
                    ? ""
                    : "none";

            return;
        }


        // =============================================
        // NORMAL STATUS
        // =============================================

        row.style.display =
            status === wanted
                ? ""
                : "none";

    });

}


// =====================================================
// VIEW AGREEMENT DETAILS
// =====================================================

function viewAgreementDetails(agreementId) {

    window.location.href =
        `agreementDetails.html?id=${agreementId}`;

}


// =====================================================
// ESCAPE HTML
// =====================================================

function escapeHtml(value) {

    if (
        value === null ||
        value === undefined
    ) {
        return "";
    }


    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

}