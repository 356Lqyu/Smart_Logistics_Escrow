async function connectWallet() {
    if (typeof window.ethereum !== 'undefined') {
        try {
            const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
            const account = accounts[0];
            
            const connectBtn = document.querySelector('.connect-btn');
            connectBtn.innerText = `🟢 ${account.substring(0, 6)}...`;
            connectBtn.style.backgroundColor = '#2a9d8f';
            connectBtn.style.color = '#ffffff';
        } catch (error) {
            console.error("User rejected wallet connection:", error);
        }
    } else {
        alert('MetaMask is not detected. Please install MetaMask to connect your wallet.');
    }
}