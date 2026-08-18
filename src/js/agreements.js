document.addEventListener("DOMContentLoaded", async () => {
    // initialize filter tab listeners
    const filterButtons = document.querySelectorAll('.filter-btn');
    filterButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            filterButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            filterTableRows(btn.getAttribute('data-filter'));
        });
    });

    // initialize search functionality
    const tableSearchInput = document.getElementById('table-search-input');
    if (tableSearchInput) {
        tableSearchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            const rows = document.querySelectorAll('#agreements-table-body tr');
            rows.forEach(row => {
                const text = row.innerText.toLowerCase();
                row.style.display = text.includes(query) ? '' : 'none';
            });
        });
    }

    // fetch real live agreement data from blockchain
    await loadAgreements();
});

async function loadAgreements() {
    const tableBody = document.getElementById('agreements-table-body');
    tableBody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: #8d99ae; padding: 30px;"><i class="fa-solid fa-spinner fa-spin"></i> Loading agreements from Supabase cache...</td></tr>`;

    try {
        // Fetch agreements from Supabase database instead of looping on-chain contract events
        const { data: agreements, error } = await supabaseClient
            .from('agreements')
            .select('*')
            .order('agreement_id', { ascending: false });

        if (error) {
            throw error;
        }

        if (!agreements || agreements.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: #8d99ae; padding: 30px;">No agreements found in database.</td></tr>`;
            return;
        }

        tableBody.innerHTML = ""; 

        agreements.forEach(rawData => {
            const statusText = rawData.status;

            // Format addresses
            const shipperAddr = `${rawData.shipper_address.substring(0, 6)}...${rawData.shipper_address.substring(38)}`;
            const carrierRaw = rawData.carrier_address;
            const carrierAddr = !carrierRaw ? "Unassigned" : `${carrierRaw.substring(0, 6)}...${carrierRaw.substring(38)}`;

            let statusClass = "status-available";
            if (statusText === "Active" || statusText === "InProgress") statusClass = "status-active";
            if (statusText === "Funded") statusClass = "status-funded";
            if (statusText === "Completed") statusClass = "status-completed";

            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="ref-col">${rawData.reference_no}</td>
                <td>${shipperAddr}</td>
                <td>${carrierAddr === 'Unassigned' ? '<span class="text-muted">Unassigned</span>' : carrierAddr}</td>
                <td>Shipment #${rawData.agreement_id}</td>
                <td><span class="priority-badge priority-express">${rawData.priority.toUpperCase()}</span></td>
                <td class="eth-val"><i class="fa-brands fa-ethereum"></i> ${rawData.escrow_amount}</td>
                <td>Cached Off-Chain</td>
                <td><span class="status-badge ${statusClass}"><span class="status-dot"></span> ${statusText}</span></td>
                <td><button class="view-btn" onclick="viewAgreementDetails(${rawData.agreement_id})"><i class="fa-regular fa-eye"></i> View</button></td>
            `;
            tableBody.appendChild(row);
        });

    } catch (error) {
        console.error("Failed to fetch agreements from Supabase:", error);
        tableBody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: #ef4444; padding: 30px;">Error loading from database. Check Supabase credentials.</td></tr>`;
    }
}

function filterTableRows(status) {
    const rows = document.querySelectorAll('#agreements-table-body tr');
    rows.forEach(row => {
        if (status === 'all') {
            row.style.display = '';
        } else {
            const statusBadgeText = row.querySelector('.status-badge')?.innerText.toLowerCase() || '';
            row.style.display = statusBadgeText.includes(status) ? '' : 'none';
        }
    });
}

function viewAgreementDetails(agreementId) {
    alert(`Fetching on-chain details for Agreement ID: ${agreementId}`);
}

function openCreateAgreementModal() {
    alert("Redirecting to Create Agreement module...");
}