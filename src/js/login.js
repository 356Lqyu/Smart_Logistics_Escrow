console.log("LOGIN.JS LOADED");

// ===============================
// PASSWORD SHOW/HIDE TOGGLE
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

  // Allow submitting with Enter from either field.
  document.getElementById("loginForm")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      loginUser();
    }
  });
});

// ===============================
// LOGIN
// ===============================

async function loginUser() {
  const message = document.getElementById("message");
  const loginBtn = document.getElementById("loginBtn");

  if (!message) {
    console.error("Login form elements not found.");
    return;
  }

  message.classList.remove("success");

  const email =
    document.getElementById("email")?.value.trim().toLowerCase() || "";
  const password = document.getElementById("password")?.value || "";

  if (!email || !password) {
    message.innerText = "Please enter your email and password.";
    return;
  }

  if (typeof supabaseClient === "undefined") {
    message.innerText = "Supabase client is not initialized.";
    return;
  }

  if (loginBtn) loginBtn.disabled = true;

  try {
    message.innerText = "Signing in...";

    const { data: profile, error: loadError } = await supabaseClient
      .from("users")
      .select("*")
      .eq("email", email)
      .eq("password", password)
      .maybeSingle();

    if (loadError) {
      throw new Error(loadError.message);
    }

    if (!profile) {
      throw new Error("Incorrect email or password.");
    }

    const roleName =
      String(profile.role || "").toLowerCase() === "carrier"
        ? "carrier"
        : "shipper";

    // ===============================
    // CONNECT & VERIFY WALLET
    // ===============================

    if (typeof window.ethereum === "undefined") {
      throw new Error(
        "Please install MetaMask to connect the wallet linked to your account.",
      );
    }

    message.innerText = "Connect the MetaMask wallet you registered with...";

    const accounts = await window.ethereum.request({
      method: "eth_requestAccounts",
    });

    if (!accounts || accounts.length === 0) {
      throw new Error("No MetaMask account was connected.");
    }

    const connectedWallet = accounts[0];

    if (
      profile.wallet_address &&
      connectedWallet.toLowerCase() !==
        String(profile.wallet_address).toLowerCase()
    ) {
      throw new Error(
        "This MetaMask account doesn't match the wallet you registered with (" +
          profile.wallet_address +
          "). Switch to that account in MetaMask and try again.",
      );
    }

    // ===============================
    // SAVE SESSION INFO & REDIRECT
    // ===============================

    localStorage.setItem("wallet", connectedWallet);
    localStorage.setItem("role", roleName);
    localStorage.setItem("userRole", roleName);
    localStorage.setItem("name", profile.name || "");
    localStorage.setItem("profileEmail", profile.email || email);

    message.classList.add("success");
    message.innerText = "Login successful! Redirecting...";

    setTimeout(() => {
      const target =
        roleName === "carrier"
          ? "carrierDashboard.html"
          : "dashboard.html?role=shipper";

      window.location.href = target;
    }, 1000);
  } catch (error) {
    console.error("Login failed:", error);

    const rawMessage = error?.message || String(error);
    message.innerText = "Login failed: " + rawMessage;
  } finally {
    if (loginBtn) loginBtn.disabled = false;
  }
}
