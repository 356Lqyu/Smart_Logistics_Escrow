let currentAccount = null;

document.addEventListener("DOMContentLoaded", () => {

    const connectButton = document.getElementById("connectWalletBtn");

    if (!connectButton) {
        console.error("Connect MetaMask button not found!");
        return;
    }

    connectButton.addEventListener("click", connectWallet);
});


async function connectWallet() {

    console.log("Connect button clicked");

    if (typeof window.ethereum === "undefined") {
        alert("Please install MetaMask");
        return;
    }

    try {

        // =====================================
        // 1. Switch / add Ganache (5777 or 1337)
        // =====================================

        await ensureGanacheNetworkForAuth();

        console.log("Switched to Ganache");

        // =====================================
        // 2. Check current network
        // =====================================

        const chainId = await window.ethereum.request({
            method: "eth_chainId"
        });

        console.log("MetaMask chain:", chainId);

        // =====================================
        // 3. Connect wallet
        // =====================================

        const accounts = await window.ethereum.request({
            method: "eth_requestAccounts"
        });

        currentAccount = accounts[0];

        console.log("Wallet:", currentAccount);

        // =====================================
        // 4. Create Web3 using MetaMask
        // =====================================

        web3 = new Web3(window.ethereum);

        console.log(
            "Web3 chain:",
            await web3.eth.getChainId()
        );

    } catch (error) {

        console.error("Connection error:", error);

        const rawMessage =
            error?.message ||
            error?.cause?.message ||
            String(error);

        if (/failed to fetch/i.test(rawMessage)) {
            alert(
                "Cannot reach Ganache.\n\n" +
                "1. Open Ganache\n" +
                "2. RPC URL: http://127.0.0.1:8545\n" +
                "3. Network ID / Chain ID: 1337 (MetaMask Localhost)\n" +
                "4. Then try again"
            );
        } else if (error.code === 4902) {

            alert(
                "Ganache network is not added to MetaMask.\n\n" +
                "Please add your Ganache network first."
            );

        } else {

            alert(
                "Connection failed:\n\n" +
                rawMessage
            );
        }
    }
}

async function ensureGanacheNetworkForAuth() {

    const networks = [
        {
            chainId: "0x1691",
            chainName: "Ganache Local 5777",
            rpcUrls: ["http://127.0.0.1:8545"],
            nativeCurrency: {
                name: "ETH",
                symbol: "ETH",
                decimals: 18
            }
        },
        {
            chainId: "0x539",
            chainName: "Ganache Local 1337",
            rpcUrls: ["http://127.0.0.1:8545"],
            nativeCurrency: {
                name: "ETH",
                symbol: "ETH",
                decimals: 18
            }
        }
    ];

    let lastError = null;

    for (const network of networks) {
        try {
            await window.ethereum.request({
                method: "wallet_switchEthereumChain",
                params: [{ chainId: network.chainId }]
            });
            return;
        } catch (switchError) {
            lastError = switchError;

            if (
                switchError.code === 4902 ||
                switchError?.data?.originalError?.code === 4902
            ) {
                try {
                    await window.ethereum.request({
                        method: "wallet_addEthereumChain",
                        params: [network]
                    });
                    return;
                } catch (addError) {
                    lastError = addError;
                }
            }
        }
    }

    throw lastError || new Error("Could not connect to Ganache network.");
}

async function checkRegistration() {

    try {

        console.log("Checking registration for:");
        console.log(currentAccount);

        const user = await contract.methods
            .users(currentAccount)
            .call();

        console.log("User data:", user);

        if (user.registered) {

            console.log("User is already registered.");

            localStorage.setItem(
                "wallet",
                currentAccount
            );

            localStorage.setItem(
                "role",
                user.role
            );

            window.location.href = "dashboard.html";

        } else {

            console.log("User is not registered.");

            window.location.href = "register.html";
        }

    } catch (error) {

        console.error(
            "Registration check failed:",
            error
        );

        alert(
            "Registration check failed:\n\n" +
            error.message
        );
    }
}


function getRoleName(role) {

    if (Number(role) === 1) {
        return "shipper";
    }

    if (Number(role) === 2) {
        return "carrier";
    }

    return "unknown";
}