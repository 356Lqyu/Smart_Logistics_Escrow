console.log("REGISTER.JS LOADED");

let selectedRole = 0;


// ===============================
// SELECT ROLE
// ===============================

function selectRole(role) {

    selectedRole = Number(role);

    const shipperBtn =
        document.getElementById("shipperBtn");

    const carrierBtn =
        document.getElementById("carrierBtn");


    if (shipperBtn) {
        shipperBtn.classList.remove("selected");
    }

    if (carrierBtn) {
        carrierBtn.classList.remove("selected");
    }


    if (selectedRole === 1) {

        if (shipperBtn) {
            shipperBtn.classList.add("selected");
        }

    }


    if (selectedRole === 2) {

        if (carrierBtn) {
            carrierBtn.classList.add("selected");
        }

    }


    console.log(
        "Selected role:",
        selectedRole
    );
}


// ===============================
// REGISTER USER
// ===============================

async function registerUser() {

    const message =
        document.getElementById("message");

    const nameElement =
        document.getElementById("name");


    if (!message || !nameElement) {

        console.error(
            "Registration form elements not found."
        );

        return;
    }


    const name =
        nameElement.value.trim();


    // ===============================
    // CHECK NAME
    // ===============================

    if (name === "") {

        message.innerText =
            "Please enter your name.";

        return;
    }


    // ===============================
    // CHECK ROLE
    // ===============================

    if (
        selectedRole !== 1 &&
        selectedRole !== 2
    ) {

        message.innerText =
            "Please select Shipper or Carrier.";

        return;
    }


    // ===============================
    // CHECK METAMASK
    // ===============================

    if (
        typeof window.ethereum === "undefined"
    ) {

        message.innerText =
            "Please install MetaMask.";

        return;
    }


    try {

        message.innerText =
            "Connecting to MetaMask...";


        // ===============================
        // SWITCH TO GANACHE
        // ===============================

        try {

            await window.ethereum.request({
                method:
                    "wallet_switchEthereumChain",

                params: [
                    {
                        chainId: "0x539"
                    }
                ]
            });

        } catch (switchError) {

            if (switchError.code === 4902) {

                throw new Error(
                    "Ganache network is not added to MetaMask. Add Ganache at chain ID 1337 and try again."
                );
            }

            throw switchError;
        }


        // ===============================
        // CONNECT WALLET
        // ===============================

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
                "No MetaMask account was connected."
            );
        }


        // IMPORTANT:
        // Use a LOCAL variable called account.
        //
        // Do NOT use:
        // const currentAccount = ...
        //
        // This avoids the currentAccount
        // initialization conflict.

        const account =
            accounts[0];


        console.log(
            "Connected wallet:",
            account
        );


        // ===============================
        // INITIALIZE WEB3
        // ===============================

        const registrationWeb3 =
            new Web3(window.ethereum);


        // ===============================
        // CHECK NETWORK
        // ===============================

        const chainId =
            await registrationWeb3.eth.getChainId();


        console.log(
            "Chain ID:",
            chainId
        );


        if (
            chainId !== 1337 &&
            chainId !== 5777
        ) {

            throw new Error(
                "Unsupported network. Connect MetaMask to Ganache (chain ID 1337)."
            );
        }


        // ===============================
        // CREATE CONTRACT INSTANCE
        // ===============================

        const registrationContract =
            new registrationWeb3.eth.Contract(
                CONTRACT_ABI,
                CONTRACT_ADDRESS
            );


        console.log(
            "Contract:",
            CONTRACT_ADDRESS
        );


        // ===============================
        // CHECK CONTRACT DEPLOYMENT
        // ===============================

        const contractCode =
            await registrationWeb3.eth.getCode(
                CONTRACT_ADDRESS
            );


        if (
            contractCode === "0x" ||
            contractCode === "0x0"
        ) {

            throw new Error(
                "LogisticsEscrow is not deployed at this address on the active Ganache network. Run truffle migrate --reset and update CONTRACT_ADDRESS."
            );
        }


        // ===============================
        // CHECK EXISTING USER
        // ===============================

        message.innerText =
            "Checking registration...";


        const user =
            await registrationContract.methods
                .users(account)
                .call();


        console.log(
            "Existing user:",
            user
        );


        // ===============================
        // ALREADY REGISTERED
        // ===============================

        if (user.registered) {

            console.log(
                "Wallet already registered. Logging in..."
            );


            // =====================================
            // CONVERT BLOCKCHAIN ROLE
            // 1 = Shipper
            // 2 = Carrier
            // =====================================

            const blockchainRole =
                Number(user.role);


            let existingRoleName;


            if (blockchainRole === 1) {

                existingRoleName = "shipper";

            }

            else if (blockchainRole === 2) {

                existingRoleName = "carrier";

            }

            else {

                throw new Error(
                    "Invalid role returned from blockchain: " +
                    user.role
                );
            }


            console.log(
                "Blockchain role:",
                blockchainRole
            );


            console.log(
                "Converted role:",
                existingRoleName
            );


            // =====================================
            // SAVE LOGIN INFORMATION
            // =====================================

            localStorage.setItem(
                "wallet",
                account
            );


            localStorage.setItem(
                "role",
                existingRoleName
            );


            localStorage.setItem(
                "userRole",
                existingRoleName
            );


            localStorage.setItem(
                "name",
                user.name
            );


            console.log(
                "Login role saved:",
                existingRoleName
            );


            message.innerText =
                "Welcome back! Redirecting to dashboard...";


            setTimeout(() => {

                window.location.href =
                    "dashboard.html?role=" +
                    existingRoleName;

            }, 1500);


            return;
        }


        // ===============================
        // BLOCKCHAIN REGISTRATION
        // ===============================

        message.innerText =
            "Please confirm the registration transaction in MetaMask.";


        console.log(
            "Registering wallet:",
            account
        );


        console.log(
            "Role:",
            selectedRole
        );


        await registrationContract.methods
            .register(
                name,
                selectedRole
            )
            .send({
                from: account
            });


        // ===============================
        // SAVE TO SUPABASE
        // ===============================

        message.innerText =
            "Saving user profile to database...";


        const roleNameStr =
            selectedRole === 1
                ? "Shipper"
                : "Carrier";


        if (
            typeof supabaseClient ===
            "undefined"
        ) {

            throw new Error(
                "Supabase client is not initialized."
            );
        }


        const {
            error: supabaseError
        } = await supabaseClient
            .from("users")
            .insert([
                {
                    wallet_address:
                        account.toLowerCase(),

                    name:
                        name,

                    role:
                        roleNameStr
                }
            ]);


        if (supabaseError) {

            console.error(
                "Error saving user to Supabase:",
                supabaseError
            );


            message.innerText =
                "Blockchain registration succeeded, but saving your profile failed: " +
                supabaseError.message;


            return;
        }


        console.log(
            "User successfully saved to Supabase cache."
        );


        // ===============================
        // SAVE LOGIN INFORMATION
        // ===============================

        const roleName =
            selectedRole === 1
                ? "shipper"
                : "carrier";


        console.log(
            "Saving role:",
            roleName
        );


        localStorage.setItem(
            "wallet",
            account
        );


        localStorage.setItem(
            "role",
            roleName
        );


        localStorage.setItem(
            "userRole",
            roleName
        );


        localStorage.setItem(
            "name",
            name
        );


        // ===============================
        // SUCCESS
        // ===============================

        console.log(
            "Registration successful!"
        );


        message.innerText =
            "Registration successful! Redirecting...";


        setTimeout(() => {

            window.location.href =
                "dashboard.html?role=" + roleName;

        }, 1500);

    } catch (error) {

        console.error(
            "Registration failed:",
            error
        );


        message.innerText =
            "Registration failed: " +
            (
                error.message ||
                String(error)
            );
    }
}