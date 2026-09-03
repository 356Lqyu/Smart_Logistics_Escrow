console.log("REGISTER.JS LOADED");

let selectedRole = 0;


// ===============================
// PASSWORD SHOW/HIDE TOGGLES
// ===============================

document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".password-toggle").forEach((btn) => {
        btn.addEventListener("click", () => {
            const targetId = btn.getAttribute("data-toggle-for");
            const input = document.getElementById(targetId);
            if (!input) return;

            const icon = btn.querySelector("i");
            const isHidden = input.type === "password";

            input.type = isHidden ? "text" : "password";
            if (icon) {
                icon.classList.toggle("fa-eye", !isHidden);
                icon.classList.toggle("fa-eye-slash", isHidden);
            }
        });
    });
});


// ===============================
// SELECT ROLE
// ===============================

function selectRole(role) {

    selectedRole = Number(role);

    const shipperBtn = document.getElementById("shipperBtn");
    const carrierBtn = document.getElementById("carrierBtn");

    if (shipperBtn) shipperBtn.classList.remove("selected");
    if (carrierBtn) carrierBtn.classList.remove("selected");

    if (selectedRole === 1 && shipperBtn) shipperBtn.classList.add("selected");
    if (selectedRole === 2 && carrierBtn) carrierBtn.classList.add("selected");

    console.log("Selected role:", selectedRole);
}


// ===============================
// FIELD VALIDATION
// ===============================

const IC_PATTERN = /^\d{6}-?\d{2}-?\d{4}$/;
const PHONE_PATTERN = /^\+?[0-9\s-]{7,15}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readRegistrationForm() {
    return {
        name: document.getElementById("name")?.value.trim() || "",
        age: document.getElementById("age")?.value.trim() || "",
        icNumber: document.getElementById("icNumber")?.value.trim() || "",
        phone: document.getElementById("phone")?.value.trim() || "",
        email: document.getElementById("email")?.value.trim().toLowerCase() || "",
        password: document.getElementById("password")?.value || "",
        confirmPassword: document.getElementById("confirmPassword")?.value || ""
    };
}

function validateRegistrationForm(form) {

    if (form.name === "") {
        return "Please enter your full name.";
    }

    const ageNum = Number(form.age);
    if (form.age === "" || !Number.isInteger(ageNum) || ageNum < 18 || ageNum > 120) {
        return "Please enter a valid age (18 or above).";
    }

    if (!IC_PATTERN.test(form.icNumber)) {
        return "Please enter a valid IC number (e.g. 990101-01-1234).";
    }

    if (!PHONE_PATTERN.test(form.phone)) {
        return "Please enter a valid phone number.";
    }

    if (!EMAIL_PATTERN.test(form.email)) {
        return "Please enter a valid email address.";
    }

    if (form.password.length < 8) {
        return "Password must be at least 8 characters.";
    }

    if (form.password !== form.confirmPassword) {
        return "Passwords do not match.";
    }

    if (selectedRole !== 1 && selectedRole !== 2) {
        return "Please select Shipper or Carrier.";
    }

    return null;
}


// ===============================
// REGISTER USER
// ===============================

async function registerUser() {

    const message = document.getElementById("message");
    const connectBtn = document.getElementById("connectWalletBtn");

    if (!message) {
        console.error("Registration form elements not found.");
        return;
    }

    message.classList.remove("success");

    const form = readRegistrationForm();
    const validationError = validateRegistrationForm(form);

    if (validationError) {
        message.innerText = validationError;
        return;
    }

    if (typeof window.ethereum === "undefined") {
        message.innerText = "Please install MetaMask.";
        return;
    }

    if (typeof supabaseClient === "undefined") {
        message.innerText = "Supabase client is not initialized.";
        return;
    }

    if (connectBtn) connectBtn.disabled = true;

    try {

        // ===============================
        // PREFLIGHT: Ganache must be online
        // before MetaMask is asked to switch.
        // ===============================

        message.innerText = "Checking Ganache connection...";

        const ganacheRpc = await findWorkingGanacheRpc();

        if (!ganacheRpc) {
            throw new Error(
                "Ganache is not running. Open Ganache first (RPC http://127.0.0.1:8545), wait until it shows accounts, then register again."
            );
        }

        message.innerText = "Connecting to MetaMask...";

        await ensureGanacheNetwork(ganacheRpc);

        const accounts = await window.ethereum.request({
            method: "eth_requestAccounts"
        });

        if (!accounts || accounts.length === 0) {
            throw new Error("No MetaMask account was connected.");
        }

        const account = accounts[0];

        console.log("Connected wallet:", account);

        // ===============================
        // INITIALIZE WEB3 + CONTRACT
        // ===============================

        const registrationWeb3 = new Web3(window.ethereum);

        const chainId = await registrationWeb3.eth.getChainId();

        if (chainId !== 1337 && chainId !== 5777) {
            throw new Error(
                "Unsupported network. Connect MetaMask to Ganache (chain ID 1337)."
            );
        }

        const registrationContract = new registrationWeb3.eth.Contract(
            CONTRACT_ABI,
            CONTRACT_ADDRESS
        );

        const contractCode = await registrationWeb3.eth.getCode(CONTRACT_ADDRESS);

        if (contractCode === "0x" || contractCode === "0x0") {
            throw new Error(
                "LogisticsEscrow is not deployed at this address on the active Ganache network. Run truffle migrate --reset and update CONTRACT_ADDRESS."
            );
        }

        // ===============================
        // CHECK EXISTING ON-CHAIN USER
        // ===============================

        message.innerText = "Checking registration...";

        const existingUser = await registrationContract.methods.users(account).call();

        if (existingUser.registered) {

            // Wallet is already registered on-chain. Either this account
            // fully exists already (go log in), or a PREVIOUS attempt
            // completed the on-chain tx but failed before finishing the
            // Supabase side (self-heal by retrying just that part).

            message.innerText = "Wallet already registered on-chain. Checking your account...";

            const { data: existingRow } = await supabaseClient
                .from("users")
                .select("email")
                .eq("wallet_address", account.toLowerCase())
                .maybeSingle();

            if (existingRow) {
                message.innerText =
                    "This wallet is already registered. Please use the Log In page instead.";
                return;
            }

            const onChainRoleNum = Number(existingUser.role);
            const roleNameStr = onChainRoleNum === 2 ? "Carrier" : "Shipper";
            const onChainName = (existingUser.name && String(existingUser.name).trim()) || form.name;

            const healed = await saveNewUserRow({ account, name: onChainName, roleNameStr, form, message });

            if (healed) {
                redirectToDashboard(roleNameStr);
            }

            return;
        }

        // ===============================
        // CHECK EMAIL AVAILABILITY
        // (before spending gas on the on-chain tx)
        // ===============================

        message.innerText = "Checking email availability...";

        const { data: existingEmailRow } = await supabaseClient
            .from("users")
            .select("email")
            .eq("email", form.email)
            .maybeSingle();

        if (existingEmailRow) {
            message.innerText = "This email is already registered. Please use the Log In page instead.";
            return;
        }

        // ===============================
        // BLOCKCHAIN REGISTRATION
        // ===============================

        message.innerText = "Please confirm the registration transaction in MetaMask.";

        try {
            await registrationContract.methods
                .register(form.name, selectedRole)
                .send({ from: account });
        } catch (sendError) {
            throw new Error(describeRevert(sendError));
        }

        // ===============================
        // SAVE PROFILE (email + password live here now, no Supabase Auth)
        // ===============================

        const roleNameStr = selectedRole === 1 ? "Shipper" : "Carrier";

        const saved = await saveNewUserRow({ account, name: form.name, roleNameStr, form, message });

        if (saved) {
            redirectToDashboard(roleNameStr);
        }

    } catch (error) {

        console.error("Registration failed:", error);

        const rawMessage = describeRevert(error);

        const isRpcDown =
            /failed to fetch/i.test(rawMessage) ||
            /too many errors/i.test(rawMessage) ||
            /retrying in/i.test(rawMessage) ||
            error?.code === -32603;

        message.innerText = isRpcDown
            ? "Registration failed: MetaMask cannot reach Ganache (RPC blocked or offline). 1) Keep Ganache open on http://127.0.0.1:8545. 2) In MetaMask Localhost: RPC http://127.0.0.1:8545, Chain ID 1337. 3) Import a Ganache account (key icon), then try again."
            : ("Registration failed: " + rawMessage);

    } finally {
        if (connectBtn) connectBtn.disabled = false;
    }
}


// ===============================
// SAVE PROFILE ROW (email + password + on-chain link, all in one row)
// Shared by the fresh-registration path and the
// already-registered-on-chain self-heal path.
// Returns true on success, false (with a message shown) on failure.
// ===============================

async function saveNewUserRow({ account, name, roleNameStr, form, message }) {

    message.innerText = "Saving user profile to database...";

    const payload = {
        email: form.email,
        password: form.password,
        wallet_address: account.toLowerCase(),
        name: name,
        age: Number(form.age),
        ic_number: form.icNumber,
        phone: form.phone,
        role: roleNameStr
    };

    const { error } = await supabaseClient
        .from("users")
        .upsert(payload, { onConflict: "email" });

    if (error) {
        console.error("Error saving user to Supabase:", error);
        message.innerText =
            "Your wallet is registered on-chain, but saving your profile failed: " +
            error.message +
            ". Click Register again to retry.";
        return false;
    }

    console.log("User successfully saved to Supabase.");

    const roleName = roleNameStr === "Carrier" ? "carrier" : "shipper";

    localStorage.setItem("wallet", account);
    localStorage.setItem("role", roleName);
    localStorage.setItem("userRole", roleName);
    localStorage.setItem("name", name);
    localStorage.setItem("profileEmail", form.email);

    message.classList.add("success");
    message.innerText = "Registration successful! Redirecting...";

    return true;
}


function redirectToDashboard(roleNameStr) {
    const roleName = roleNameStr === "Carrier" ? "carrier" : "shipper";

    setTimeout(() => {
        const target =
            roleName === "carrier"
                ? "carrierDashboard.html"
                : "dashboard.html?role=shipper";

        window.location.href = target;
    }, 1800);
}


// ===============================
// DECODE REVERT REASON
// GanacheUI sometimes surfaces contract requires as a generic
// "Internal JSON-RPC error" with no reason string attached at the
// top level; the actual message is usually nested a few levels down.
// ===============================

function describeRevert(error) {

    // MetaMask/web3 often wrap the real error several levels deep, e.g.
    // { message: "Internal JSON-RPC error.", data: { message: "VM Exception... revert", data: "0x" } }.
    // Collect every message we can find and prefer whichever one actually
    // mentions "revert" instead of just taking the outermost (usually
    // generic) one.
    const candidates = [
        error?.data?.data?.message,
        error?.data?.originalError?.message,
        error?.data?.message,
        error?.innerError?.data?.message,
        error?.innerError?.message,
        error?.cause?.data?.message,
        error?.cause?.message,
        error?.message,
        String(error)
    ].filter((m) => typeof m === "string" && m.trim() !== "");

    const best = candidates.find((m) => /revert/i.test(m)) || candidates[0] || String(error);

    const reasonMatch = /revert\s+(.+)$/i.exec(best);
    if (reasonMatch && reasonMatch[1] && reasonMatch[1].trim() !== "" && reasonMatch[1].trim() !== "revert") {
        return reasonMatch[1].trim();
    }

    // Find the actual revert data (hex string), if present, so we can
    // tell an empty revert (no reason at all — selector mismatch / stale
    // deployment) apart from an ABI-encoded Error(string) reason.
    const revertData =
        error?.data?.data?.data ||
        error?.data?.data ||
        error?.data ||
        null;

    if (/revert/i.test(best)) {
        if (revertData === "0x" || revertData === "0x0") {
            return (
                best +
                " — Ganache returned NO reason string (revert data is empty), which means this call almost certainly hit a function selector that doesn't exist on the bytecode currently deployed at CONTRACT_ADDRESS — i.e. the contract deployed on this Ganache instance is stale or doesn't match the ABI in contract.js. This is NOT the shape of a require(condition, \"message\") failure, which always includes a reason string. Fix: run `truffle migrate --reset`, then copy the freshly deployed address for your active network (1337 or 5777) from build/contracts/LogisticsEscrow.json into CONTRACT_ADDRESS in src/js/contract.js, and make sure the ABI array in contract.js matches that same build file."
            );
        }

        return (
            best +
            " (no reason string could be parsed out, but Ganache did return revert data — check the browser console for the full error object)"
        );
    }

    return best;
}


// ===============================
// FIND WORKING GANACHE RPC
// ===============================

async function findWorkingGanacheRpc() {

    const candidates = [
        "http://127.0.0.1:8545",
        "http://localhost:8545",
        "http://127.0.0.1:7545",
        "http://localhost:7545"
    ];

    for (const rpcUrl of candidates) {

        try {

            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 2500);

            const response = await fetch(rpcUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    method: "eth_chainId",
                    params: [],
                    id: 1
                }),
                signal: controller.signal
            });

            clearTimeout(timer);

            if (!response.ok) continue;

            const data = await response.json();

            if (data?.result) {
                console.log("Ganache RPC online:", rpcUrl, data.result);
                return rpcUrl;
            }

        } catch (error) {
            console.warn("Ganache RPC offline:", rpcUrl, error?.message || error);
        }
    }

    return null;
}


// ===============================
// ENSURE GANACHE NETWORK
// ===============================

async function ensureGanacheNetwork(rpcUrl) {

    const currentHex = await window.ethereum.request({ method: "eth_chainId" });
    const current = parseInt(currentHex, 16);

    if (current === 5777 || current === 1337) {
        console.log("Already on Ganache chain:", current);
        return;
    }

    const ganacheNetworks = [
        {
            chainId: "0x1691", // 5777
            chainName: "Ganache Local",
            rpcUrls: [rpcUrl],
            nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }
        },
        {
            chainId: "0x539", // 1337
            chainName: "Ganache Local 1337",
            rpcUrls: [rpcUrl],
            nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }
        }
    ];

    let lastError = null;

    for (const network of ganacheNetworks) {

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

    const rawMessage = lastError?.message || lastError?.cause?.message || "Unknown network error";

    if (/failed to fetch/i.test(rawMessage) || /too many errors/i.test(rawMessage)) {
        throw new Error(
            "MetaMask RPC is blocked or Ganache is offline. Start Ganache, fix MetaMask RPC to " +
            rpcUrl +
            ", wait 30 seconds, then retry."
        );
    }

    throw lastError || new Error("Could not switch MetaMask to Ganache.");
}