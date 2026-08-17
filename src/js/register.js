console.log("REGISTER.JS LOADED");

let selectedRole = 0;


// ===============================
// SELECT ROLE
// ===============================

function selectRole(role) {

    selectedRole = role;

    const shipperBtn =
        document.getElementById("shipperBtn");

    const carrierBtn =
        document.getElementById("carrierBtn");


    shipperBtn.classList.remove("selected");
    carrierBtn.classList.remove("selected");


    if (role === 1) {

        shipperBtn.classList.add("selected");

    }

    if (role === 2) {

        carrierBtn.classList.add("selected");

    }

    console.log("Selected role:", role);
}


// ===============================
// REGISTER USER
// ===============================

async function registerUser() {

    const message =
        document.getElementById("message");

    const name =
        document.getElementById("name").value.trim();


    // Check name

    if (name === "") {

        message.innerText =
            "Please enter your name.";

        return;
    }


    // Check role

    if (selectedRole === 0) {

        message.innerText =
            "Please select Shipper or Carrier.";

        return;
    }


    // Check MetaMask

    if (typeof window.ethereum === "undefined") {

        message.innerText =
            "Please install MetaMask.";

        return;
    }


    try {

        message.innerText =
            "Connecting to MetaMask...";


        // ===============================
        // CONNECT WALLET
        // ===============================

        try {

            await window.ethereum.request({
                method: "wallet_switchEthereumChain",
                params: [{ chainId: "0x539" }]
            });

        } catch (switchError) {

            if (switchError.code === 4902) {
                throw new Error(
                    "Ganache network is not added to MetaMask. Add Ganache at chain ID 1337 and try again."
                );
            }

            throw switchError;
        }

        const accounts =
            await window.ethereum.request({
                method: "eth_requestAccounts"
            });


        currentAccount =
            accounts[0];


        console.log(
            "Connected wallet:",
            currentAccount
        );


        // ===============================
        // INITIALIZE WEB3
        // ===============================

        web3 =
            new Web3(window.ethereum);


        // ===============================
        // CHECK NETWORK
        // ===============================

        const chainId =
            await web3.eth.getChainId();

        console.log(
            "Chain ID:",
            chainId
        );

        if (chainId !== 1337 && chainId !== 5777) {
            throw new Error(
                "Unsupported network. Connect MetaMask to Ganache (chain ID 1337)."
            );
        }


        // ===============================
        // CREATE CONTRACT
        // ===============================

        contract =
            new web3.eth.Contract(
                CONTRACT_ABI,
                CONTRACT_ADDRESS
            );


        console.log(
            "Contract:",
            CONTRACT_ADDRESS
        );

        const contractCode = await web3.eth.getCode(CONTRACT_ADDRESS);

        if (contractCode === "0x" || contractCode === "0x0") {
            throw new Error(
                "LogisticsEscrow is not deployed at this address on the active Ganache network. Run truffle migrate --reset."
            );
        }


        // ===============================
        // CHECK EXISTING USER
        // ===============================

        message.innerText =
            "Checking registration...";


        const user =
            await contract.methods
                .users(currentAccount)
                .call();


        console.log(
            "Existing user:",
            user
        );


        if (user.registered) {

            message.innerText =
                "This wallet is already registered.";

            return;
        }


        // ===============================
        // REGISTER ON BLOCKCHAIN
        // ===============================

        message.innerText =
            "Please confirm the registration transaction in MetaMask.";


        await contract.methods
            .register(name, selectedRole)
            .send({
                from: currentAccount
            });


        // ===============================
        // SUCCESS
        // ===============================

        console.log(
            "Registration successful!"
        );


        localStorage.setItem(
            "wallet",
            currentAccount
        );


        localStorage.setItem(
            "role",
            selectedRole
        );


        localStorage.setItem(
            "name",
            name
        );


        message.innerText =
            "Registration successful! Redirecting...";


        setTimeout(() => {

            window.location.href =
                "dashboard.html";

        }, 1500);


    } catch (error) {

        console.error(
            "Registration failed:",
            error
        );


        message.innerText =
            "Registration failed: " +
            error.message;

    }

}