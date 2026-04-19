const socket = io();

let myName = "";
let otherName = null;

let peerConnection = null;
let localStream = null;

let incomingOffer = null;
let caller = null;

let videoDeviceId = null;
let audioTrack = null;

const config = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" }
    ]
};

// ===== JOIN =====
function join() {
    myName = document.getElementById("username").value.trim();
    if (!myName) return alert("Enter name");

    socket.emit("join", myName);

    document.getElementById("login").style.display = "none";
    document.getElementById("app").style.display = "flex";
}

// ===== USERS =====
socket.on("users-update", (users) => {
    otherName = users.find(u => u !== myName) || null;

    document.getElementById("status").textContent =
        otherName ? "Online 🟢" : "Waiting...";
});

// ===============================
// 🎥 CAMERA STREAM (WITH NOISE CANCEL)
// ===============================
async function getStream(video = true, deviceId = null) {
    const constraints = {
        audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
        },
        video: video
            ? (deviceId
                ? { deviceId: { exact: deviceId } }
                : true)
            : false
    };

    return await navigator.mediaDevices.getUserMedia(constraints);
}

// ===== START CALL =====
async function startCall(video) {
    if (!otherName) return alert("No user");

    localStream = await getStream(video, videoDeviceId);

    document.getElementById("localVideo").srcObject = localStream;

    peerConnection = new RTCPeerConnection(config);

    localStream.getTracks().forEach(t =>
        peerConnection.addTrack(t, localStream)
    );

    peerConnection.ontrack = (e) => {
        document.getElementById("remoteVideo").srcObject = e.streams[0];
    };

    peerConnection.onicecandidate = (e) => {
        if (e.candidate) {
            socket.emit("candidate", {
                to: otherName,
                candidate: e.candidate
            });
        }
    };

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    socket.emit("offer", {
        to: otherName,
        offer,
        from: myName
    });
}

// ===== AUDIO / VIDEO =====
function startAudioCall() {
    startCall(false);
}

function startVideoCall() {
    startCall(true);
}

// ===== INCOMING CALL =====
socket.on("offer", ({ offer, from }) => {
    incomingOffer = offer;
    caller = from;

    document.getElementById("callerName").textContent =
        from + " is calling...";

    document.getElementById("incomingCall").style.display = "flex";
});

// ===== ACCEPT CALL =====
async function acceptCall() {
    document.getElementById("incomingCall").style.display = "none";

    localStream = await getStream(true, videoDeviceId);

    document.getElementById("localVideo").srcObject = localStream;

    peerConnection = new RTCPeerConnection(config);

    localStream.getTracks().forEach(t =>
        peerConnection.addTrack(t, localStream)
    );

    peerConnection.ontrack = (e) => {
        document.getElementById("remoteVideo").srcObject = e.streams[0];
    };

    peerConnection.onicecandidate = (e) => {
        if (e.candidate) {
            socket.emit("candidate", {
                to: caller,
                candidate: e.candidate
            });
        }
    };

    await peerConnection.setRemoteDescription(incomingOffer);

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    socket.emit("answer", {
        to: caller,
        answer,
        from: myName
    });
}

// ===== REJECT =====
function rejectCall() {
    document.getElementById("incomingCall").style.display = "none";
    incomingOffer = null;
    caller = null;
}

// ===== ANSWER =====
socket.on("answer", async ({ answer }) => {
    if (peerConnection) {
        await peerConnection.setRemoteDescription(answer);
    }
});

// ===== CANDIDATE =====
socket.on("candidate", async ({ candidate }) => {
    if (peerConnection) {
        await peerConnection.addIceCandidate(candidate);
    }
});

// ===============================
// 🔁 CAMERA FLIP FUNCTION
// ===============================
async function flipCamera() {
    if (!localStream) return;

    const videoTrack = localStream.getVideoTracks()[0];

    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(d => d.kind === "videoinput");

    if (videoDevices.length < 2) return alert("No second camera");

    const currentIndex = videoDevices.findIndex(d => d.deviceId === videoTrack.getSettings().deviceId);

    const nextDevice = videoDevices[(currentIndex + 1) % videoDevices.length];

    videoDeviceId = nextDevice.deviceId;

    const newStream = await getStream(true, videoDeviceId);

    const newVideoTrack = newStream.getVideoTracks()[0];

    peerConnection.getSenders().forEach(sender => {
        if (sender.track.kind === "video") {
            sender.replaceTrack(newVideoTrack);
        }
    });

    localStream.getTracks().forEach(t => t.stop());
    localStream = newStream;

    document.getElementById("localVideo").srcObject = localStream;
}

// ===============================
// 👆 FULLSCREEN TOGGLE
// ===============================
function toggleFullScreen(video) {
    if (!document.fullscreenElement) {
        video.requestFullscreen().catch(err => console.log(err));
    } else {
        document.exitFullscreen();
    }
}

// ===== END CALL =====
function endCall() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
    }

    document.getElementById("localVideo").srcObject = null;
    document.getElementById("remoteVideo").srcObject = null;
}