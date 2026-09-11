let currentProfileEmail = null;

const IC_PATTERN = /^\d{6}-?\d{2}-?\d{4}$/;
const PHONE_PATTERN = /^\+?[0-9\s-]{7,15}$/;

document.addEventListener("DOMContentLoaded", async () => {
  try {
    if (typeof window.ethereum === "undefined") {
      window.location.href = "index.html";
      return;
    }

    const accounts = await window.ethereum.request({
      method: "eth_accounts",
    });

    if (!accounts?.length) {
      window.location.href = "index.html";
      return;
    }

    const connectedWallet = accounts[0];
    localStorage.setItem("wallet", connectedWallet);

    const short =
      connectedWallet.substring(0, 6) +
      "..." +
      connectedWallet.substring(connectedWallet.length - 4);

    const topWallet = document.getElementById("top-wallet-address");
    if (topWallet) {
      topWallet.innerText = short;
      topWallet.title = connectedWallet;
    }

    // ?wallet=0x... lets a shipper view a carrier's public profile (or
    // vice versa) before accepting/dealing with them -- read-only, no
    // edit/password/avatar-upload controls, no private email shown.
    const urlParams = new URLSearchParams(window.location.search);
    const requestedWallet = urlParams.get("wallet");
    const viewedWallet =
      requestedWallet &&
      requestedWallet.toLowerCase() !== connectedWallet.toLowerCase()
        ? requestedWallet
        : connectedWallet;
    const isOwnProfile =
      viewedWallet.toLowerCase() === connectedWallet.toLowerCase();

    const viewBanner = document.getElementById("profile-view-banner");
    if (viewBanner) viewBanner.hidden = isOwnProfile;

    await loadProfile(viewedWallet, isOwnProfile);

    if (isOwnProfile) {
      setupEditModal(viewedWallet);
      setupChangePasswordModal();
      setupAvatarUpload(viewedWallet);
    } else {
      ["edit-profile-btn", "change-password-btn", "change-avatar-btn"].forEach(
        (id) => {
          const el = document.getElementById(id);
          if (el) el.style.display = "none";
        },
      );
    }

    const searchInput = document.getElementById("search-input");
    if (searchInput) {
      searchInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          const role =
            localStorage.getItem("userRole") ||
            localStorage.getItem("role") ||
            "shipper";
          window.location.href = `agreements.html?role=${encodeURIComponent(role)}`;
        }
      });
    }
  } catch (error) {
    console.error("Profile page failed:", error);
  }
});

async function loadProfile(wallet, isOwnProfile = true) {
  const walletLower = wallet.toLowerCase();

  let user = null;

  try {
    const { data, error } = await supabaseClient
      .from("users")
      .select("*")
      .eq("wallet_address", walletLower)
      .maybeSingle();

    if (!error) user = data;
  } catch (error) {
    console.warn("Could not load user profile:", error);
  }

  // The viewed user's role always comes from their own data (Supabase
  // row, which mirrors the on-chain role) -- localStorage only makes
  // sense as a fallback for the viewer's OWN profile, never someone
  // else's, or a carrier's profile would render using the viewer's role.
  const roleRaw =
    user?.role ||
    (isOwnProfile
      ? localStorage.getItem("userRole") || localStorage.getItem("role")
      : null) ||
    "shipper";
  const isCarrier =
    String(roleRaw).toLowerCase() === "carrier" || String(roleRaw) === "2";

  const displayName =
    user?.name ||
    (isOwnProfile ? localStorage.getItem("name") : null) ||
    (isCarrier ? "Carrier Account" : "Shipper Account");

  const email = isOwnProfile
    ? user?.email || localStorage.getItem("profileEmail") || "Not set"
    : "Private";

  currentProfileEmail = isOwnProfile ? user?.email || null : null;

  const registeredAt = user?.created_at || user?.registered_at || null;

  setText("profile-name", displayName);
  setText(
    "profile-role-pill",
    isOwnProfile
      ? `Role Locked — ${isCarrier ? "Carrier" : "Shipper"}`
      : isCarrier
        ? "Carrier"
        : "Shipper",
  );
  setText(
    "profile-subtitle",
    isCarrier ? "Carrier logistics identity" : "Shipper logistics identity",
  );
  const icNumber = isOwnProfile ? user?.ic_number || "Not set" : "Private";
  const phone = isOwnProfile ? user?.phone || "Not set" : "Private";

  setText("profile-wallet", wallet);
  setText("profile-email", email);
  setText("profile-ic", icNumber);
  setText("profile-phone", phone);
  setText(
    "profile-registered",
    registeredAt
      ? new Date(registeredAt).toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
        })
      : "On-chain registered",
  );

  const avatar = document.getElementById("profile-avatar");
  if (avatar) {
    avatar.innerText = getInitials(displayName);
  }

  await loadProfilePicture(wallet);
  await loadTokenBalance(wallet);
  await loadWalletBalance(wallet);

  if (typeof web3 !== "undefined" || window.ethereum) {
    try {
      const w3 = new Web3(window.ethereum);
      const chainId = await w3.eth.getChainId();
      setText("profile-network", describeNetwork(chainId));
    } catch (error) {
      console.warn("Network lookup failed:", error);
    }
  }

  const agreements = await loadRoleAgreements(walletLower, isCarrier);
  renderProfileStats(agreements, isCarrier);

  const editName = document.getElementById("edit-name-input");
  const editEmail = document.getElementById("edit-email-input");
  const editIc = document.getElementById("edit-ic-input");
  const editPhone = document.getElementById("edit-phone-input");
  if (editName)
    editName.value =
      displayName === "Shipper Account" || displayName === "Carrier Account"
        ? ""
        : displayName;
  if (editEmail) editEmail.value = email === "Not set" ? "" : email;
  if (editIc) editIc.value = icNumber === "Not set" ? "" : icNumber;
  if (editPhone) editPhone.value = phone === "Not set" ? "" : phone;
}

async function loadRoleAgreements(walletLower, isCarrier) {
  const { data, error } = await supabaseClient
    .from("agreements")
    .select("*")
    .order("agreement_id", { ascending: false });

  if (error) {
    console.warn("Agreements load failed:", error);
    return [];
  }

  return (data || []).filter((a) => {
    if (isCarrier) {
      return (
        a.carrier_address && a.carrier_address.toLowerCase() === walletLower
      );
    }
    return a.shipper_address && a.shipper_address.toLowerCase() === walletLower;
  });
}

function renderProfileStats(agreements, isCarrier) {
  const total = agreements.length;
  const completed = agreements.filter(
    (a) => normalize(a.status) === "completed",
  ).length;
  const active = agreements.filter((a) => {
    const s = normalize(a.status);
    return s === "created" || s === "in progress";
  }).length;
  const refunded = agreements.filter((a) => {
    const s = normalize(a.status);
    return s === "cancelled" || s === "expired" || s === "refunded";
  }).length;

  const closed = completed + refunded;
  const successRate = closed ? Math.round((completed / closed) * 100) : 0;
  const disputeRate = total ? ((refunded / total) * 100).toFixed(1) : "0.0";
  const trustScore =
    total === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            100,
            Math.round(successRate * 0.85 + (100 - Number(disputeRate)) * 0.15),
          ),
        );

  const now = new Date();
  const thisMonth = agreements.filter((a) => {
    const ts = Number(a.created_time || 0) * 1000;
    const d = ts > 0 ? new Date(ts) : new Date(a.created_at || 0);
    return (
      d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
    );
  }).length;

  setText("stat-agreements", String(total));
  setText("stat-agreements-meta", `+${thisMonth} this month`);
  setText("stat-completed", String(completed));
  setText("stat-completed-meta", `${successRate}% success`);
  setText("stat-trust", `${trustScore}/100`);
  setText(
    "stat-trust-meta",
    trustScore >= 80 ? "Strong on-chain record" : "Keep completing agreements",
  );

  setText("trust-score-big", `${trustScore}/100`);
  const fill = document.getElementById("trust-bar-fill");
  if (fill) fill.style.width = `${trustScore}%`;

  setText("metric-ontime", `${successRate}%`);
  setText("metric-dispute", `${disputeRate}%`);
  setText("metric-active", String(active));

  // Role-specific reputation labels
  const metricLabels = document.querySelectorAll(".profile-metric span");

  if (metricLabels.length >= 3) {
    if (isCarrier) {
      metricLabels[0].innerText = "On-Time Deliveries";
      metricLabels[1].innerText = "Dispute / Refund Rate";
      metricLabels[2].innerText = "Active Agreements";
    } else {
      metricLabels[0].innerText = "Successful Completions";
      metricLabels[1].innerText = "Refund / Cancel Rate";
      metricLabels[2].innerText = "Active Shipments";
    }
  }

  const reputationTitle = document.querySelector(
    ".profile-reputation-header h3",
  );
  const reputationSub = document.querySelector(".profile-reputation-header p");

  if (!isCarrier) {
    if (reputationTitle) {
      reputationTitle.innerText = "Shipper Trust Score";
    }
    if (reputationSub) {
      reputationSub.innerText =
        "Based on completed shipments, refunds, and escrow reliability";
    }
  }
}

function setupEditModal(wallet) {
  const modal = document.getElementById("edit-profile-modal");
  const openBtn = document.getElementById("edit-profile-btn");
  const cancelBtn = document.getElementById("cancel-edit-btn");
  const saveBtn = document.getElementById("save-edit-btn");
  const message = document.getElementById("edit-message");

  if (!modal || !openBtn) return;

  openBtn.addEventListener("click", () => {
    modal.hidden = false;
    if (message) message.innerText = "";
  });

  cancelBtn?.addEventListener("click", () => {
    modal.hidden = true;
  });

  modal.addEventListener("click", (event) => {
    if (event.target === modal) modal.hidden = true;
  });

  saveBtn?.addEventListener("click", async () => {
    const name = document.getElementById("edit-name-input")?.value.trim() || "";
    const email =
      document.getElementById("edit-email-input")?.value.trim() || "";
    const icNumber =
      document.getElementById("edit-ic-input")?.value.trim() || "";
    const phone =
      document.getElementById("edit-phone-input")?.value.trim() || "";

    if (!name) {
      if (message) message.innerText = "Display name is required.";
      return;
    }

    if (icNumber && !IC_PATTERN.test(icNumber)) {
      if (message)
        message.innerText =
          "Please enter a valid IC number (e.g. 990101-01-1234).";
      return;
    }

    if (phone && !PHONE_PATTERN.test(phone)) {
      if (message) message.innerText = "Please enter a valid phone number.";
      return;
    }

    if (message) message.innerText = "Saving...";

    localStorage.setItem("name", name);
    localStorage.setItem("profileEmail", email || "");

    try {
      const payload = {
        name,
        email: email || null,
        ic_number: icNumber || null,
        phone: phone || null,
      };

      const { error } = await supabaseClient
        .from("users")
        .update(payload)
        .eq("wallet_address", wallet.toLowerCase());

      if (error) {
        // Some columns may not exist on this schema — fall back to name only.
        const { error: nameError } = await supabaseClient
          .from("users")
          .update({ name })
          .eq("wallet_address", wallet.toLowerCase());

        if (nameError) throw nameError;
      }

      if (message) message.innerText = "Saved.";
      modal.hidden = true;
      await loadProfile(wallet);
    } catch (error) {
      console.error(error);
      // Still update UI from localStorage even if Supabase schema lacks email
      setText("profile-name", name);
      setText("profile-email", email || "Not set");
      const avatar = document.getElementById("profile-avatar");
      if (avatar) avatar.innerText = getInitials(name);
      if (message) {
        message.innerText =
          "Saved locally. Supabase update skipped or failed: " +
          (error.message || String(error));
      }
      modal.hidden = true;
    }
  });
}

function setupChangePasswordModal() {
  const modal = document.getElementById("change-password-modal");
  const openBtn = document.getElementById("change-password-btn");
  const cancelBtn = document.getElementById("cancel-password-btn");
  const saveBtn = document.getElementById("save-password-btn");
  const message = document.getElementById("password-message");
  const currentInput = document.getElementById("current-password-input");
  const newInput = document.getElementById("new-password-input");
  const confirmInput = document.getElementById("confirm-password-input");

  if (!modal || !openBtn) return;

  function resetFields() {
    if (currentInput) currentInput.value = "";
    if (newInput) newInput.value = "";
    if (confirmInput) confirmInput.value = "";
    if (message) message.innerText = "";
  }

  openBtn.addEventListener("click", () => {
    resetFields();
    modal.hidden = false;
  });

  cancelBtn?.addEventListener("click", () => {
    modal.hidden = true;
  });

  modal.addEventListener("click", (event) => {
    if (event.target === modal) modal.hidden = true;
  });

  saveBtn?.addEventListener("click", async () => {
    const currentPassword = currentInput?.value || "";
    const newPassword = newInput?.value || "";
    const confirmPassword = confirmInput?.value || "";

    if (!currentProfileEmail) {
      if (message) {
        message.innerText =
          "No login email on file for this account. Register or set an email in Edit Profile before changing your password.";
      }
      return;
    }

    if (!currentPassword) {
      if (message) message.innerText = "Enter your current password.";
      return;
    }

    if (newPassword.length < 8) {
      if (message)
        message.innerText = "New password must be at least 8 characters.";
      return;
    }

    if (newPassword !== confirmPassword) {
      if (message) message.innerText = "New passwords do not match.";
      return;
    }

    if (saveBtn) saveBtn.disabled = true;
    if (message) message.innerText = "Verifying current password...";

    try {
      const { data: matchingRow, error: verifyError } = await supabaseClient
        .from("users")
        .select("email")
        .eq("email", currentProfileEmail)
        .eq("password", currentPassword)
        .maybeSingle();

      if (verifyError) {
        throw verifyError;
      }

      if (!matchingRow) {
        throw new Error("Current password is incorrect.");
      }

      if (message) message.innerText = "Updating password...";

      const { error: updateError } = await supabaseClient
        .from("users")
        .update({ password: newPassword })
        .eq("email", currentProfileEmail);

      if (updateError) {
        throw updateError;
      }

      if (message) {
        message.innerText = "Password updated.";
        message.style.color = "#34d399";
      }

      setTimeout(() => {
        modal.hidden = true;
        resetFields();
        if (message) message.style.color = "";
      }, 1200);
    } catch (error) {
      console.error("Change password failed:", error);
      if (message) {
        message.innerText = error?.message || String(error);
        message.style.color = "";
      }
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  });
}

function getInitials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) return "LE";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function describeNetwork(chainId) {
  if (chainId === 1337 || chainId === 5777) return `Local Ganache (${chainId})`;
  if (chainId === 11155111) return "Sepolia Testnet";
  return `Chain ${chainId}`;
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.innerText = value;
}

// ===============================
// ON-CHAIN PROFILE PICTURE
//
// The image is downsized/compressed client-side to a small
// JPEG, converted to raw bytes, and stored directly in the
// LogisticsEscrow contract via setProfilePicture(). Nothing
// image-related ever touches Supabase.
// ===============================

const AVATAR_MAX_BYTES = 60000; // stays under the 65536-byte contract cap

function getEscrowContract() {
  const w3 = new Web3(window.ethereum);
  return new w3.eth.Contract(CONTRACT_ABI, CONTRACT_ADDRESS);
}

function getTokenContract() {
  const w3 = new Web3(window.ethereum);
  return new w3.eth.Contract(TOKEN_ABI, TOKEN_CONTRACT_ADDRESS);
}

async function loadProfilePicture(wallet) {
  const avatar = document.getElementById("profile-avatar");
  if (!avatar) return;

  try {
    const contract = getEscrowContract();
    const hexData = await contract.methods.getProfilePicture(wallet).call();

    if (hexData && hexData !== "0x") {
      const dataUrl = hexToImageDataUrl(hexData);
      avatar.style.backgroundImage = `url("${dataUrl}")`;
      avatar.style.backgroundSize = "cover";
      avatar.style.backgroundPosition = "center";
      avatar.innerText = "";
    }
  } catch (error) {
    console.warn("Could not load on-chain profile picture:", error);
  }
}

async function loadTokenBalance(wallet) {
  try {
    const token = getTokenContract();
    const balanceWei = await token.methods.balanceOf(wallet).call();
    const balance = Web3.utils.fromWei(String(balanceWei), "ether");
    const rounded = Math.round(Number(balance) * 100) / 100;
    setText("stat-tokens", `${rounded} LTT`);
  } catch (error) {
    console.warn("Could not load LTT balance:", error);
    setText("stat-tokens", "0 LTT");
  }
}

async function loadWalletBalance(wallet) {
  try {
    const w3 = new Web3(window.ethereum);
    const balanceWei = await w3.eth.getBalance(wallet);
    const balance = Web3.utils.fromWei(balanceWei, "ether");
    const rounded = Math.round(Number(balance) * 10000) / 10000;
    setText("stat-eth-balance", `${rounded} ETH`);
  } catch (error) {
    console.warn("Could not load wallet ETH balance:", error);
    setText("stat-eth-balance", "— ETH");
  }
}

function setupAvatarUpload(wallet) {
  const changeBtn = document.getElementById("change-avatar-btn");
  const fileInput = document.getElementById("avatar-file-input");
  if (!changeBtn || !fileInput) return;

  changeBtn.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    fileInput.value = "";
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert("Please choose an image file.");
      return;
    }

    changeBtn.disabled = true;
    const originalIcon = changeBtn.innerHTML;
    changeBtn.innerHTML =
      '<i class="fa-solid fa-spinner fa-spin" style="font-size:12px;"></i>';

    try {
      const bytes = await compressImageToBytes(file, AVATAR_MAX_BYTES);
      const hexData = bytesToHex(bytes);

      const contract = getEscrowContract();
      await contract.methods.setProfilePicture(hexData).send({ from: wallet });

      const avatar = document.getElementById("profile-avatar");
      if (avatar) {
        avatar.style.backgroundImage = `url("${bytesToDataUrl(bytes)}")`;
        avatar.style.backgroundSize = "cover";
        avatar.style.backgroundPosition = "center";
        avatar.innerText = "";
      }
    } catch (error) {
      console.error("Profile picture update failed:", error);
      alert(
        "Could not save profile picture: " +
          (error?.code === 4001
            ? "Transaction was rejected in MetaMask."
            : error.message || String(error)),
      );
    } finally {
      changeBtn.disabled = false;
      changeBtn.innerHTML = originalIcon;
    }
  });
}

// IMAGE COMPRESSION
//
// Resizes + re-encodes the image as JPEG, shrinking quality
// and then dimensions until it fits under maxBytes.
async function compressImageToBytes(file, maxBytes) {
  const sourceDataUrl = await readFileAsDataURL(file);
  const image = await loadImageElement(sourceDataUrl);

  let dim =
    Math.max(image.width, image.height) > 256
      ? 256
      : Math.max(image.width, image.height);
  dim = Math.max(dim, 32);

  for (let attempt = 0; attempt < 12; attempt++) {
    const scale = dim / Math.max(image.width, image.height);
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(image, 0, 0, width, height);

    for (let quality = 0.7; quality >= 0.2; quality -= 0.1) {
      const outDataUrl = canvas.toDataURL("image/jpeg", quality);
      const bytes = dataUrlToBytes(outDataUrl);
      if (bytes.length <= maxBytes) {
        return bytes;
      }
    }

    dim = Math.round(dim * 0.75);
  }

  throw new Error(
    "Image could not be compressed small enough. Try a simpler/smaller image.",
  );
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image."));
    img.src = dataUrl;
  });
}

function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.split(",")[1] || "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToDataUrl(bytes, mime) {
  mime = mime || "image/jpeg";
  let binary = "";
  for (let i = 0; i < bytes.length; i++)
    binary += String.fromCharCode(bytes[i]);
  return `data:${mime};base64,${btoa(binary)}`;
}

function bytesToHex(bytes) {
  let hex = "0x";
  for (let i = 0; i < bytes.length; i++)
    hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

function hexToImageDataUrl(hexData, mime) {
  const hex = hexData.replace(/^0x/, "");
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytesToDataUrl(bytes, mime);
}
