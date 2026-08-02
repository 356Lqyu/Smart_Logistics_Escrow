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
    
    try {
        // Check if MetaMask or local Web3 provider is present
        if (typeof window.ethereum === 'undefined') {
            tableBody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: #ef4444; padding: 30px;">MetaMask / Web3 Provider not detected! Please connect your wallet.</td></tr>`;
            return;
        }

        // initialize Ethers.js provider and contract instance
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);

        // Call smart contract public counter function
        const totalAgreements = await contract.agreementCounter();
        const count = totalAgreements.toNumber();

        if (count === 0) {
            tableBody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: #8d99ae; padding: 30px;">No agreements created on-chain yet.</td></tr>`;
            return;
        }

        tableBody.innerHTML = ""; 

        // Loop all on-chain agreements from ID 1 up to agreementCounter
        for (let i = 1; i <= count; i++) {
            const rawData = await contract.getAgreementBasic(i);
            
            // map Solidity enum status numbers to readable UI text
            // enum mapping: 0: Created, 1: Funded, 2: InProgress, 3: Completed, 4: Refunded, 5: Cancelled, 6: Expired
            const statusMap = ["Created", "Funded", "Active", "Completed", "Refunded", "Cancelled", "Expired"];
            const numericStatus = rawData.status;
            const statusText = statusMap[numericStatus] || "Unknown";

            // format address strings for clean UI display
            const shipperAddr = `${rawData.shipper.substring(0, 6)}...${rawData.shipper.substring(38)}`;
            const carrierRaw = rawData.carrier;
            const carrierAddr = (carrierRaw === "0x0000000000000000000000000000000000000000") ? "Unassigned" : `${carrierRaw.substring(0, 6)}...${carrierRaw.substring(38)}`;

            // Convert escrow amount from Wei to ETH
            const ethEscrow = ethers.utils.formatEther(rawData.escrowAmount);

            // Determine CSS classes for badges
            let statusClass = "status-available";
            if (statusText === "Active" || statusText === "InProgress") statusClass = "status-active";
            if (statusText === "Funded") statusClass = "status-funded";
            if (statusText === "Completed") statusClass = "status-completed";

            // Build table row dynamically from real blockchain data
            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="ref-col">${rawData.referenceNo}</td>
                <td>${shipperAddr}</td>
                <td>${carrierAddr === 'Unassigned' ? '<span class="text-muted">Unassigned</span>' : carrierAddr}</td>
                <td>Shipment #${rawData.agreementId}</td>
                <td><span class="priority-badge priority-express">EXPRESS</span></td>
                <td class="eth-val"><i class="fa-brands fa-ethereum"></i> ${ethEscrow}</td>
                <td>Live On-Chain</td>
                <td><span class="status-badge ${statusClass}"><span class="status-dot"></span> ${statusText}</span></td>
                <td><button class="view-btn" onclick="viewAgreementDetails(${rawData.agreementId})"><i class="fa-regular fa-eye"></i> View</button></td>
            `;
            tableBody.appendChild(row);
        }

    } catch (error) {
        console.error("Failed to fetch agreements from smart contract:", error);
        tableBody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: #ef4444; padding: 30px;">Error syncing with smart contract. Check contract address & network.</td></tr>`;
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