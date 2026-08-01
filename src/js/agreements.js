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

    // fetch agreement data from smart contract
    await loadAgreementsFromBlockchain();
});

async function loadAgreementsFromBlockchain() {
    const tableBody = document.getElementById('agreements-table-body');
    
    try {
        // integrate ethers.js with compiled contract artifact:
        // const provider = new ethers.providers.Web3Provider(window.ethereum);
        // const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);
        // const totalAgreements = await contract.agreementCounter();
        
        // Simulating delay and mapping data retrieved from shipper/blockchain storage
        setTimeout(() => {
            // Mocking retrieved records from the smart contract mappings
            const fetchedAgreements = [
                { id: 1, ref: "LG-2026-0001", shipper: "0x742d...3A4f", carrier: "0x89f2...7B2c", payload: "Electronics & Tech", priority: "EXPRESS", escrow: "2.5", deadline: "Jul 20", status: "Active" },
                { id: 2, ref: "LG-2026-0002", shipper: "0x742d...3A4f", carrier: "Unassigned", payload: "Automotive Parts", priority: "URGENT", escrow: "4.2", deadline: "Jul 25", status: "Funded" },
                { id: 3, ref: "LG-2026-0003", shipper: "0x742d...3A4f", carrier: "0x3E7c...8F5a", payload: "Chemical Supplies", priority: "NORMAL", escrow: "1.8", deadline: "Jul 15", status: "Completed" }
            ];

            if (fetchedAgreements.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: #8d99ae; padding: 30px;">No agreements found on-chain.</td></tr>`;
                return;
            }

            tableBody.innerHTML = ""; // Clear loader
            fetchedAgreements.forEach(agreement => {
                let statusClass = "status-available";
                if (agreement.status === "Active") statusClass = "status-active";
                if (agreement.status === "Funded") statusClass = "status-funded";
                if (agreement.status === "Completed") statusClass = "status-completed";

                let priorityClass = "priority-normal";
                if (agreement.priority === "EXPRESS") priorityClass = "priority-express";
                if (agreement.priority === "URGENT") priorityClass = "priority-urgent";

                const row = document.createElement('tr');
                row.innerHTML = `
                    <td class="ref-col">${agreement.ref}</td>
                    <td>${agreement.shipper}</td>
                    <td>${agreement.carrier === 'Unassigned' ? '<span class="text-muted">Unassigned</span>' : agreement.carrier}</td>
                    <td>${agreement.payload}</td>
                    <td><span class="priority-badge ${priorityClass}">${agreement.priority}</span></td>
                    <td class="eth-val"><i class="fa-brands fa-ethereum"></i> ${agreement.escrow}</td>
                    <td>${agreement.deadline}</td>
                    <td><span class="status-badge ${statusClass}"><span class="status-dot"></span> ${agreement.status}</span></td>
                    <td><button class="view-btn" onclick="viewAgreementDetails(${agreement.id})"><i class="fa-regular fa-eye"></i> View</button></td>
                `;
                tableBody.appendChild(row);
            });
        }, 1000);

    } catch (error) {
        console.error("Failed to fetch agreements from blockchain:", error);
        tableBody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: #ef4444; padding: 30px;">Error loading data from smart contract.</td></tr>`;
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
    alert(`Viewing agreement ID: ${agreementId} details retrieved from shipper contract.`);
}

function openCreateAgreementModal() {
    alert("Redirecting to Create Agreement form...");
}