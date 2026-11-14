const socket = io(window.location.origin, { transports: ["websocket", "polling"] });

let myName = "";
let selectedUser = "";
let onlineUsers = [];

// Call state
let peerConnection = null;
let localStream = null;
let activePeer = "";        // Tracks the current call partner reliably
let incomingOffer = null;
let incomingCaller = "";
let incomingCallType = "video";
let callType = "video";
let pendingCandidates = [];
let toastTimer;

const $ = (id) => document.getElementById(id);

// Add a TURN server here for calls across different networks / mobile data
const config = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
    // Example TURN config (required when peers are behind strict NATs/firewalls):
    // {
    //   urls: "turn:your-turn-server.com:3478",
    //   username: "user",
    //   credential: "password"
    // }
  ]
};

function initials(name) {
  return (name || "?").trim().split(/\s+/).slice(0, 2).map(x => x[0]).join("").toUpperCase();
}

function showToast(message) {
  $("toast").textContent = message;
  $("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 3200);
}

function setCallStatus(text) {
  $("callStatus").textContent = text;
}

$("loginForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("username").value.trim();
  if (!name) return;
  socket.emit("join", name, (result) => {
    if (!result?.ok) return showToast(result?.error || "Could not join.");
    myName = result.name;
    $("login").hidden = true;
    $("app").hidden = false;
    $("myName").textContent = myName;
    $("myAvatar").textContent = initials(myName);
  });
});

$("logoutBtn").addEventListener("click", () => location.reload());

socket.on("connect", () => {
  $("connectionStatus").textContent = "Connected";
});
socket.on("disconnect", () => {
  $("connectionStatus").textContent = "Reconnecting…";
});
socket.on("join-error", showToast);

socket.on("users-update", (users) => {
  onlineUsers = users.filter(u => u !== myName);
  $("peopleCount").textContent = onlineUsers.length;
  renderPeople();

  // If the person we are currently in a call with goes offline, clean up the call
  if (activePeer && !onlineUsers.includes(activePeer)) {
    showToast(`${activePeer} disconnected during the call.`);
    cleanupCall(false);
  }

  if (selectedUser && !onlineUsers.includes(selectedUser)) {
    showToast(`${selectedUser} went offline.`);
    selectedUser = "";
    updateSelectedUser();
  }
});

socket.on("user-disconnected", ({ name }) => {
  if (name === activePeer) {
    showToast(`${name} disconnected.`);
    cleanupCall(false);
  } else if (name === selectedUser) {
    showToast(`${name} disconnected.`);
  }
});

function renderPeople() {
  const list = $("peopleList");
  list.replaceChildren();
  onlineUsers.forEach(name => {
    const button = document.createElement("button");
    button.className = "person" + (selectedUser === name ? " selected" : "");
    button.innerHTML = `<span class="avatar">${initials(name)}</span><span class="person-name"></span><span class="person-state">●</span>`;
    button.querySelector(".person-name").textContent = name;
    button.addEventListener("click", () => {
      selectedUser = name;
      updateSelectedUser();
      renderPeople();
      $("messages").replaceChildren();
      $("emptyState").hidden = true;
      addSystemMessage(`You are chatting with ${name}.`);
      
      // Automatically close the slide-over menu on mobile phones
      closeMobileSidebar();
    });
    list.appendChild(button);
  });
}

function updateSelectedUser() {
  $("chatTitle").textContent = selectedUser || "Choose someone to chat";
  $("audioCallBtn").disabled = !selectedUser;
  $("videoCallBtn").disabled = !selectedUser;
  $("messageInput").disabled = !selectedUser;
  $("sendBtn").disabled = !selectedUser;
  $("emptyState").hidden = !!selectedUser;
}

function addMessage(from, message, time, mine) {
  const li = document.createElement("li");
  li.className = mine ? "user1" : "user2";
  li.append(document.createTextNode(message));
  const meta = document.createElement("span");
  meta.className = "message-meta";
  meta.textContent = `${from} · ${new Date(time || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  li.appendChild(meta);
  $("messages").appendChild(li);
  $("messages").scrollTop = $("messages").scrollHeight;
}

function addSystemMessage(text) {
  const li = document.createElement("li");
  li.style.cssText = "align-self:center;background:transparent;border:0;color:#8793ad;font-size:11px;text-align:center";
  li.textContent = text;
  $("messages").appendChild(li);
}

$("inputArea").addEventListener("submit", (e) => {
  e.preventDefault();
  const message = $("messageInput").value.trim();
  if (!message || !selectedUser) return;
  socket.emit("chat-message", { to: selectedUser, message });
  addMessage(myName, message, Date.now(), true);
  $("messageInput").value = "";
});

$("emojiBtn").addEventListener("click", () => {
  $("messageInput").value += " 😊";
  $("messageInput").focus();
});

socket.on("chat-message", ({ from, message, time }) => {
  if (from !== selectedUser) showToast(`New message from ${from}`);
  if (from === selectedUser) addMessage(from, message, time, false);
});

// ===== WebRTC =====
async function getMedia(video) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera/Mic requires HTTPS or localhost.");
  }
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: video ? { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } } : false
  });
}

function attachStream(videoEl, stream, muted = false) {
  videoEl.srcObject = stream;
  videoEl.muted = muted;
  videoEl.playsInline = true;
  videoEl.autoplay = true;
  videoEl.play().catch((err) => console.warn("Video play() prevented:", err));
}

function createPeer(remoteName) {
  peerConnection = new RTCPeerConnection(config);
  pendingCandidates = [];

  peerConnection.ontrack = (event) => {
    const remoteVid = $("remoteVideo");
    // Fallback to creating a MediaStream if event.streams[0] is empty
    const remoteStream = event.streams?.[0] || new MediaStream([event.track]);
    attachStream(remoteVid, remoteStream, false);
    $("remotePlaceholder").hidden = true;
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("candidate", { to: remoteName, candidate: event.candidate });
    }
  };

  peerConnection.oniceconnectionstatechange = () => {
    const iceState = peerConnection?.iceConnectionState;
    if (iceState === "checking") setCallStatus("Establishing peer connection…");
    if (iceState === "connected" || iceState === "completed") {
      setCallStatus("Connected · encrypted peer connection");
    }
    if (iceState === "disconnected") setCallStatus("Connection interrupted…");
    if (iceState === "failed") {
      setCallStatus("ICE failed. A TURN server is required for this network.");
    }
  };

  peerConnection.onconnectionstatechange = () => {
    const state = peerConnection?.connectionState;
    if (state === "connected") setCallStatus("Connected · encrypted peer connection");
    if (state === "failed") setCallStatus("Connection failed. A TURN server may be needed.");
  };

  if (localStream) {
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
  }
}

async function startCall(type) {
  if (!selectedUser) return showToast("Choose an online person first.");
  if (peerConnection || incomingOffer) return showToast("You are already in or receiving a call.");

  try {
    callType = type;
    activePeer = selectedUser;
    localStream = await getMedia(type === "video");
    attachStream($("localVideo"), localStream, true);

    openCallPanel(activePeer);
    createPeer(activePeer);

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit("offer", { to: activePeer, offer, callType: type });
    setCallStatus("Calling… waiting for answer");
  } catch (err) {
    cleanupCall(false);
    showToast(
      err.name === "NotAllowedError"
        ? "Allow camera/microphone access in your browser."
        : `Call error: ${err.message}`
    );
  }
}

$("audioCallBtn").addEventListener("click", () => startCall("audio"));
$("videoCallBtn").addEventListener("click", () => startCall("video"));

function openCallPanel(name) {
  $("callPanel").hidden = false;
  $("remoteCallName").textContent = name;
  $("remoteAvatar").textContent = initials(name);
  $("remotePlaceholder").hidden = false;
}

socket.on("offer", ({ offer, from, callType: type }) => {
  // Reject if already in a call or ringing from someone else
  if (peerConnection || incomingOffer) {
    socket.emit("reject-call", { to: from });
    return;
  }
  incomingOffer = offer;
  incomingCaller = from;
  incomingCallType = type || "video";
  $("callerName").textContent = `${from} is calling`;
  $("incomingType").textContent = incomingCallType.toUpperCase();
  $("incomingCall").hidden = false;
});

$("acceptBtn").addEventListener("click", acceptCall);

async function acceptCall() {
  if (!incomingOffer || !incomingCaller) return;
  $("incomingCall").hidden = true;

  const targetPeer = incomingCaller;
  const offerToAccept = incomingOffer;
  // Clear incoming state immediately so it doesn't leak into future calls
  incomingOffer = null;
  incomingCaller = "";

  try {
    callType = incomingCallType;
    activePeer = targetPeer;
    localStream = await getMedia(callType === "video");
    attachStream($("localVideo"), localStream, true);

    openCallPanel(activePeer);
    createPeer(activePeer);

    await peerConnection.setRemoteDescription(new RTCSessionDescription(offerToAccept));
    await flushCandidates();

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit("answer", { to: activePeer, answer });
    setCallStatus("Answer sent · connecting");

    selectedUser = activePeer;
    updateSelectedUser();
    renderPeople();
  } catch (err) {
    showToast(`Could not answer: ${err.message}`);
    cleanupCall(true);
  }
}

$("rejectBtn").addEventListener("click", () => {
  if (incomingCaller) socket.emit("reject-call", { to: incomingCaller });
  $("incomingCall").hidden = true;
  incomingOffer = null;
  incomingCaller = "";
});

socket.on("answer", async ({ answer, from }) => {
  if (!peerConnection || (from && from !== activePeer)) return;
  try {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    await flushCandidates();
    setCallStatus("Answer received · connecting");
  } catch (err) {
    showToast(`Answer error: ${err.message}`);
  }
});

socket.on("candidate", async ({ candidate, from }) => {
  if (!candidate || !peerConnection || (from && from !== activePeer)) return;
  try {
    const iceCandidate = new RTCIceCandidate(candidate);
    if (peerConnection.remoteDescription && peerConnection.remoteDescription.type) {
      await peerConnection.addIceCandidate(iceCandidate);
    } else {
      pendingCandidates.push(iceCandidate);
    }
  } catch (err) {
    console.warn("ICE candidate error", err);
  }
});

async function flushCandidates() {
  const list = pendingCandidates.splice(0);
  for (const candidate of list) {
    try {
      await peerConnection.addIceCandidate(candidate);
    } catch (err) {
      console.warn("Failed to add queued ICE candidate:", err);
    }
  }
}

socket.on("call-rejected", ({ from }) => {
  if (from && from !== activePeer) return;
  showToast(`${from} declined the call.`);
  cleanupCall(false);
});

socket.on("end-call", ({ from }) => {
  // Handle case where caller cancels before receiver accepts
  if (from === incomingCaller) {
    $("incomingCall").hidden = true;
    incomingOffer = null;
    incomingCaller = "";
    showToast(`${from} cancelled the call.`);
    return;
  }
  if (from && from !== activePeer) return;
  showToast(`${from} ended the call.`);
  cleanupCall(false);
});

$("endCallBtn").addEventListener("click", () => {
  cleanupCall(true);
});

function cleanupCall(notify = false) {
  if (notify && activePeer) {
    socket.emit("end-call", { to: activePeer });
  }
  if (peerConnection) {
    peerConnection.ontrack = null;
    peerConnection.onicecandidate = null;
    peerConnection.onconnectionstatechange = null;
    peerConnection.oniceconnectionstatechange = null;
    peerConnection.close();
    peerConnection = null;
  }
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  $("localVideo").srcObject = null;
  $("remoteVideo").srcObject = null;
  $("callPanel").hidden = true;
  $("incomingCall").hidden = true;
  $("remotePlaceholder").hidden = false;
  $("muteBtn").classList.remove("active");
  $("muteBtn").textContent = "🎙";
  $("cameraBtn").classList.remove("active");

  activePeer = "";
  incomingCaller = "";
  incomingOffer = null;
  pendingCandidates = [];
}

$("muteBtn").addEventListener("click", () => {
  const track = localStream?.getAudioTracks()[0];
  if (!track) return showToast("No microphone track.");
  track.enabled = !track.enabled;
  $("muteBtn").classList.toggle("active", !track.enabled);
  $("muteBtn").textContent = track.enabled ? "🎙" : "🔇";
});

$("cameraBtn").addEventListener("click", () => {
  const track = localStream?.getVideoTracks()[0];
  if (!track) return showToast("This is an audio-only call.");
  track.enabled = !track.enabled;
  $("cameraBtn").classList.toggle("active", !track.enabled);
});

$("flipBtn").addEventListener("click", async () => {
  if (!localStream || callType !== "video") return showToast("Camera is not active.");
  try {
    const oldTrack = localStream.getVideoTracks()[0];
    const settings = oldTrack.getSettings();
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter(d => d.kind === "videoinput");
    if (cameras.length < 2) return showToast("No second camera found.");

    const index = cameras.findIndex(d => d.deviceId === settings.deviceId);
    const next = cameras[(index + 1) % cameras.length];

    // Stop old track first so mobile hardware releases the camera lock
    oldTrack.stop();

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: next.deviceId } },
      audio: false
    });
    const newTrack = stream.getVideoTracks()[0];
    const sender = peerConnection?.getSenders().find(s => s.track?.kind === "video");
    if (sender) await sender.replaceTrack(newTrack);

    localStream.removeTrack(oldTrack);
    localStream.addTrack(newTrack);
    attachStream($("localVideo"), localStream, true);
  } catch (err) {
    showToast(`Camera switch failed: ${err.message}`);
  }
});

$("fullscreenBtn").addEventListener("click", () => {
  const target = $("remoteVideo");
  if (!document.fullscreenElement) target.requestFullscreen?.().catch(() => {});
  else document.exitFullscreen?.();
});

$("minimizeCall").addEventListener("click", () => {
  $("callPanel").hidden = true;
  showToast("Call minimized. Double-click call button to restore.");
});

$("audioCallBtn").addEventListener("dblclick", () => {
  if (peerConnection) $("callPanel").hidden = false;
});
$("videoCallBtn").addEventListener("dblclick", () => {
  if (peerConnection) $("callPanel").hidden = false;
});

window.addEventListener("beforeunload", () => {
  if (activePeer) socket.emit("end-call", { to: activePeer });
});

// ===== Mobile Drawer Handlers =====
function openMobileSidebar() {
  $("sidebar")?.classList.add("open");
  if ($("sidebarBackdrop")) $("sidebarBackdrop").hidden = false;
}

function closeMobileSidebar() {
  $("sidebar")?.classList.remove("open");
  if ($("sidebarBackdrop")) $("sidebarBackdrop").hidden = true;
}

$("menuBtn")?.addEventListener("click", openMobileSidebar);
$("closeSidebarBtn")?.addEventListener("click", closeMobileSidebar);
$("sidebarBackdrop")?.addEventListener("click", closeMobileSidebar);
