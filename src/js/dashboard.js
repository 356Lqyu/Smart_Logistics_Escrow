document.addEventListener("DOMContentLoaded", async () => {

    try {

        // =====================================
        // 1. CHECK METAMASK
        // =====================================

        if (typeof window.ethereum === "undefined") {

            console.error("MetaMask is not installed.");

            window.location.href = "index.html";

            return;
        }


        // =====================================
        // 2. CONNECT TO METAMASK
        // =====================================

        const accounts =
            await window.ethereum.request({
                method: "eth_accounts"
            });


        if (!accounts || accounts.length === 0) {

            console.error("No MetaMask account connected.");

            window.location.href = "index.html";

            return;
        }


        const currentAccount =
            accounts[0];


        console.log(
            "Dashboard wallet:",
            currentAccount
        );


        // =====================================
        // 3. SAVE WALLET ADDRESS
        // =====================================

        localStorage.setItem(
            "wallet",
            currentAccount
        );


        // =====================================
        // 4. DISPLAY WALLET ADDRESS
        // =====================================

        const shortAddress =
            currentAccount.substring(0, 6) +
            "..." +
            currentAccount.substring(
                currentAccount.length - 4
            );


        const sidebarWallet =
            document.getElementById(
                "sidebar-wallet-addr"
            );


        const topWallet =
            document.getElementById(
                "top-wallet-address"
            );


        if (sidebarWallet) {

            sidebarWallet.innerText =
                shortAddress;

            sidebarWallet.title =
                currentAccount;
        }


        if (topWallet) {

            topWallet.innerText =
                shortAddress;

            topWallet.title =
                currentAccount;
        }


        // =====================================
        // 5. LOAD SIDEBAR
        // =====================================

        const response =
            await fetch("sidebar.html");


        const sidebarHtml =
            await response.text();


        document.getElementById(
            "sidebar-container"
        ).innerHTML = sidebarHtml;


        // =====================================
        // 6. GET USER ROLE
        // =====================================

        const urlParams =
            new URLSearchParams(
                window.location.search
            );


        const userRole =
            urlParams.get("role") ||
            localStorage.getItem("userRole") ||
            localStorage.getItem("role") ||
            "shipper";


        const isCarrier =
            userRole.toLowerCase() === "carrier";


        localStorage.setItem(
            "userRole",
            userRole
        );


        // =====================================
        // 7. SIDEBAR ELEMENTS
        // =====================================

        const roleNameEl =
            document.getElementById(
                "sidebar-role-name"
            );


        const profileIconEl =
            document.getElementById(
                "sidebar-profile-icon"
            );


        const menuListEl =
            document.getElementById(
                "sidebar-menu-list"
            );


        const searchInputEl =
            document.getElementById(
                "search-input"
            );


        const sidebarWalletEl =
            document.getElementById(
                "sidebar-wallet-addr"
            );


        // =====================================
        // 8. DISPLAY WALLET AFTER SIDEBAR LOAD
        // =====================================

        if (sidebarWalletEl) {

            sidebarWalletEl.innerText =
                shortAddress;

            sidebarWalletEl.title =
                currentAccount;
        }


        // =====================================
        // 9. CARRIER SIDEBAR
        // =====================================

        if (isCarrier) {

            roleNameEl.innerText =
                "Carrier";


            profileIconEl.className =
                "profile-icon carrier-icon-bg";


            profileIconEl.innerHTML =
                '<i class="fa-solid fa-truck-fast"></i>';


            searchInputEl.placeholder =
                "Search available jobs...";


            menuListEl.innerHTML = `

                <li>
                    <a href="dashboard.html?role=carrier">
                        <i data-lucide="layout-dashboard"></i>
                        Dashboard
                    </a>
                </li>

                <li>
                    <a href="#">
                        <i data-lucide="box"></i>
                        Available Jobs
                    </a>
                </li>

                <li>
                    <a href="#">
                        <i data-lucide="file-text"></i>
                        My Contracts
                    </a>
                </li>

                <li>
                    <a href="#">
                        <i data-lucide="target"></i>
                        Milestones
                    </a>
                </li>

                <li>
                    <a href="#">
                        <i data-lucide="coins"></i>
                        LogiTrust Tokens
                    </a>
                </li>

                <li>
                    <a href="#">
                        <i data-lucide="user-round"></i>
                        Profile
                    </a>
                </li>

            `;

        }


        // =====================================
        // 10. SHIPPER SIDEBAR
        // =====================================

        else {

            roleNameEl.innerText =
                "Shipper";


            profileIconEl.className =
                "profile-icon";


            profileIconEl.innerHTML =
                '<i class="fa-solid fa-box"></i>';


            searchInputEl.placeholder =
                "Search agreements...";


            menuListEl.innerHTML = `

                <li>
                    <a href="dashboard.html?role=shipper">
                        <i data-lucide="layout-dashboard"></i>
                        Dashboard
                    </a>
                </li>

                <li>
                    <a href="agreements.html">
                        <i data-lucide="file-text"></i>
                        Agreements
                    </a>
                </li>

                <li>
                    <a href="createAgreement.html">
                        <i data-lucide="plus-circle"></i>
                        Create Agreement
                    </a>
                </li>

                <li>
                    <a href="transactionHistory.html">
                        <i data-lucide="rotate-ccw"></i>
                        Transaction History
                    </a>
                </li>

                <li>
                    <a href="#">
                        <i data-lucide="user-round"></i>
                        Profile
                    </a>
                </li>

            `;

        }


        // =====================================
        // 11. HIGHLIGHT CURRENT PAGE
        // =====================================

        const currentPage =
            window.location.pathname
                .split("/")
                .pop();


        menuListEl
            .querySelectorAll("a")
            .forEach(link => {

                const linkPage =
                    link
                        .getAttribute("href")
                        ?.split("?")[0];


                if (linkPage === currentPage) {
                    link.classList.add("active");
                }

            });


        // =====================================
        // 12. RENDER LUCIDE ICONS
        // =====================================

        if (typeof lucide !== "undefined") {

            lucide.createIcons();

        }


        // =====================================
        // 13. LOAD NETWORK INFORMATION
        // =====================================

        const chainIdEl =
            document.getElementById(
                "chain-id"
            );


        const web3 =
            new Web3(window.ethereum);


        const chainId =
            await web3.eth.getChainId();


        if (chainIdEl) {

            chainIdEl.innerText =
                chainId;

        }


        console.log(
            `Dashboard loaded successfully for ${userRole}`
        );

        console.log(
            `Connected account: ${currentAccount}`
        );

    }

    catch (error) {

        console.error(
            "Error loading dashboard:",
            error
        );

    }

});