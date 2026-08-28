document.addEventListener('DOMContentLoaded', () => {
    const content = document.getElementById('content');

    navigator.mediaDevices.getUserMedia({ audio: true })
        .then((stream) => {
            content.innerHTML = `
                <h2>Permission Granted! 🎤</h2>
                <p class="success">You can now use the microphone in the 1e sidebar.</p>
                <p>This tab will close automatically in a few seconds...</p>
            `;
            // Stop tracks immediately so we don't hold the mic
            stream.getTracks().forEach(track => track.stop());
            setTimeout(() => window.close(), 3000);
        })
        .catch((err) => {
            content.innerHTML = `
                <h2>Permission Denied ❌</h2>
                <p class="error">You must allow microphone access to use speech-to-text.</p>
                <p>If you accidentally blocked it, please click the lock icon in the address bar to change the permission, then reload this page.</p>
            `;
            console.error('Microphone permission error:', err);
        });
});
