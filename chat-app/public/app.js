const socket = io();

let myName = "";
let otherName = "";
let peerConnection = null;
let localStream = null;
let remoteCandidates = [];
let isCalling = false;
let messages = [];
let typingTimeout = null;
let recorder = null;
let audioChunks = [];
let callInterval = null;
let callSeconds = 0;

// STUN/TURN configuration
const config = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" }
    ]
};

// ===== JOIN CHAT =====
function join() {
    myName = document.getElementById("username").value.trim();
    if (!myName) return alert("Enter your name");
    otherName = myName === "User1" ? "User2" : "User1";
    socket.emit("join", myName);

    document.getElementById("login").style.display = "none";
    document.getElementById("app").style.display = "flex";
    document.getElementById("chatName").textContent = otherName;
}

// ===== MESSAGES =====
function addMessage(from, content, type = "text") {
    if (!from || !content) return;
    messages.push({ type, from, content });
    renderMessages();
}

function renderMessages() {
    const msgUl = document.getElementById("messages");
    msgUl.innerHTML = "";
    messages.forEach(msg => {
        const li = document.createElement("li");
        li.classList.add(msg.from === myName ? "user1" : "user2");
        if (msg.type === "text") li.textContent = msg.content;
        else if (msg.type === "file") {
            const a = document.createElement("a");
            a.href = msg.content;
            a.target = "_blank";
            a.textContent = "Download File";
            li.textContent = msg.from + ": ";
            li.appendChild(a);
        }
        else if (msg.type === "voice") {
            const audio = document.createElement("audio");
            audio.src = msg.content;
            audio.controls = true;
            li.textContent = msg.from + ": ";
            li.appendChild(audio);
        }
        msgUl.appendChild(li);
    });
    msgUl.scrollTop = msgUl.scrollHeight;
}

function sendMessage() {
    const input = document.getElementById("msg");
    const msg = input.value.trim();
    if (!msg) return;
    socket.emit("private-message", { to: otherName, message: msg, from: myName });
    addMessage(myName, msg, "text");
    input.value = "";
}

// ===== FILE SHARE =====
async function sendFile(file) {
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    try {
        const res = await fetch("/upload", { method: "POST", body: formData });
        const data = await res.json();
        if (!data.filePath) return alert("Upload failed");
        socket.emit("file-message", { to: otherName, filePath: data.filePath, from: myName });
        addMessage(myName, data.filePath, "file");
    } catch (err) { console.error(err); alert("File upload error"); }
}

// ===== TYPING INDICATOR =====
function sendTyping() {
    socket.emit("typing", { to: otherName, from: myName });
}

socket.on("typing", data => {
    if (data?.from === otherName) {
        const indicator = document.getElementById("typingIndicator");
        indicator.textContent = otherName + " is typing...";
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => { indicator.textContent = ""; }, 1500);
    }
});

// ===== VOICE MESSAGE =====
async function startRecording() {
    if (!navigator.mediaDevices) return alert("Microphone not supported");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recorder = new MediaRecorder(stream);
    audioChunks = [];
    recorder.ondataavailable = e => { audioChunks.push(e.data); };
    recorder.onstop = async () => {
        const blob = new Blob(audioChunks, { type: "audio/webm" });
        const file = new File([blob], "voice.webm");
        await sendFile(file);
    };
    recorder.start();
}

function stopRecording() {
    if (recorder && recorder.state !== "inactive") recorder.stop();
}

// ===== CALL TIMER =====
function startCallTimer() {
    callSeconds = 0;
    document.getElementById("callTimer").textContent = "00:00";
    callInterval = setInterval(() => {
        callSeconds++;
        const mins = String(Math.floor(callSeconds / 60)).padStart(2, '0');
        const secs = String(callSeconds % 60).padStart(2, '0');
        document.getElementById("callTimer").textContent = `${mins}:${secs}`;
    }, 1000);
}
function stopCallTimer() { clearInterval(callInterval); document.getElementById("callTimer").textContent = "00:00"; }

// ===== AUDIO / VIDEO CALL =====
async function startAudioCall() { await startCall(false); }
async function startVideoCall() { await startCall(true); }

async function startCall(isVideo) {
    if (isCalling) return;
    isCalling = true;
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: isVideo });
        document.getElementById("localVideo").srcObject = localStream;
        peerConnection = new RTCPeerConnection(config);
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
        peerConnection.ontrack = event => { document.getElementById("remoteVideo").srcObject = event.streams[0]; };
        peerConnection.onicecandidate = e => { if (e.candidate) socket.emit("candidate", { to: otherName, candidate: e.candidate, from: myName }); };
        peerConnection.onconnectionstatechange = () => {
            if (peerConnection.connectionState === "disconnected" || peerConnection.connectionState === "failed") endCall();
        };

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit("offer", { to: otherName, offer, from: myName });
        startCallTimer();
    } catch (err) { console.error(err); alert("Microphone/Camera access required"); isCalling = false; }
}

socket.on("offer", async ({ offer, from }) => {
    if (!offer || !from) return;
    const accept = confirm("Incoming call from " + from);
    if (!accept) return;
    otherName = from;
    isCalling = true;
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    document.getElementById("localVideo").srcObject = localStream;
    peerConnection = new RTCPeerConnection(config);
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    peerConnection.ontrack = event => { document.getElementById("remoteVideo").srcObject = event.streams[0]; };
    peerConnection.onicecandidate = e => { if (e.candidate) socket.emit("candidate", { to: from, candidate: e.candidate, from: myName }); };
    peerConnection.onconnectionstatechange = () => {
        if (peerConnection.connectionState === "disconnected" || peerConnection.connectionState === "failed") endCall();
    };

    await peerConnection.setRemoteDescription(offer);
    for (let c of remoteCandidates) await peerConnection.addIceCandidate(c);
    remoteCandidates = [];
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit("answer", { to: from, answer, from: myName });
    startCallTimer();
});

socket.on("answer", async ({ answer }) => { if (peerConnection) { await peerConnection.setRemoteDescription(answer); for (let c of remoteCandidates) await peerConnection.addIceCandidate(c); remoteCandidates = []; } });
socket.on("candidate", async ({ candidate }) => { if (peerConnection && peerConnection.remoteDescription) await peerConnection.addIceCandidate(candidate); else remoteCandidates.push(candidate); });

function endCall() {
    isCalling = false;
    stopCallTimer();
    if (peerConnection) { peerConnection.close(); peerConnection = null; }
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    document.getElementById("remoteVideo").srcObject = null;
    document.getElementById("localVideo").srcObject = null;
}

// ===== SOCKET EVENTS =====
socket.on("private-message", data => { if (data?.from && data?.message) addMessage(data.from, data.message, "text"); });
socket.on("file-message", data => { if (data?.from && data?.filePath) addMessage(data.from, data.filePath, "file"); });
