document.addEventListener("DOMContentLoaded", async () => {
    try {
        // load the shared sidebar template for shipper and carrier
        const response = await fetch('sidebar.html');
        const sidebarHtml = await response.text();
        document.getElementById('sidebar-container').innerHTML = sidebarHtml;

        // then will check user role (passed via URL ?role=carrier or stored locally)
        const urlParams = new URLSearchParams(window.location.search);
        const userRole = urlParams.get('role') || localStorage.getItem('userRole') || 'shipper';
        const isCarrier = userRole.toLowerCase() === 'carrier';

        // save state locally
        localStorage.setItem('userRole', userRole);

        // get DOM elements to customize the sidebar item
        const roleNameEl = document.getElementById('sidebar-role-name');
        const profileIconEl = document.getElementById('sidebar-profile-icon');
        const menuListEl = document.getElementById('sidebar-menu-list');
        const searchInputEl = document.getElementById('search-input');

        // if role = carrier
        if (isCarrier) {
            roleNameEl.innerText = "Carrier";
            profileIconEl.className = "profile-icon carrier-icon-bg";
            profileIconEl.innerHTML = '<i class="fa-solid fa-truck-fast"></i>';
            searchInputEl.placeholder = "Search available jobs...";

            menuListEl.innerHTML = `
                <li><a href="dashboard.html?role=carrier"><i data-lucide="layout-dashboard"></i> Dashboard</a></li>
                <li><a href="#"><i data-lucide="box"></i> Available Jobs</a></li>
                <li><a href="#"><i data-lucide="file-text"></i> My Contracts</a></li>
                <li><a href="#"><i data-lucide="target"></i> Milestones</a></li>
                <li><a href="#"><i data-lucide="coins"></i> LogiTrust Tokens</a></li>
                <li><a href="#"><i data-lucide="user-round"></i> Profile</a></li>
            `;
        } else {
            roleNameEl.innerText = "Shipper";
            profileIconEl.className = "profile-icon";
            profileIconEl.innerHTML = '<i class="fa-solid fa-box"></i>';
            searchInputEl.placeholder = "Search agreements...";

            menuListEl.innerHTML = `
                <li><a href="dashboard.html?role=shipper"><i data-lucide="layout-dashboard"></i> Dashboard</a></li>
                <li><a href="agreements.html"><i data-lucide="file-text"></i> Agreements</a></li>
                <li><a href="#"><i data-lucide="target"></i> Milestones</a></li>
                <li><a href="#"><i data-lucide="rotate-ccw"></i> Transaction History</a></li>
                <li><a href="#"><i data-lucide="user-round"></i> Profile</a></li>
            `;
        }

        // Automatically highlight current page

        const currentPage = window.location.pathname.split('/').pop();

        menuListEl.querySelectorAll('a').forEach(link => {

            const linkPage = link
                .getAttribute('href')
                ?.split('?')[0];

            if (linkPage === currentPage) {
                link.classList.add('active');
            }

        });

        // render Lucide icons for sidebar item's icon
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }

        console.log(`Dashboard loaded successfully for role: ${userRole}`);
    } catch (error) {
        console.error("Error loading dashboard layout components:", error);
    }
});