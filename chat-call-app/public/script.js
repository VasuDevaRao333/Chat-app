const socket = io(window.location.origin, { transports: ["websocket", "polling"] });

let myName = "";
let selectedUser = "";
let onlineUsers = [];
let peerConnection = null;
let localStream = null;
let incomingOffer = null;
let caller = "";
let incomingCallType = "video";
let callType = "video";
let pendingCandidates = [];
let toastTimer;

const $ = (id) => document.getElementById(id);
const config = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
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
function setCallStatus(text) { $("callStatus").textContent = text; }

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
  if (selectedUser && !onlineUsers.includes(selectedUser)) {
    showToast(`${selectedUser} went offline.`);
    selectedUser = "";
    updateSelectedUser();
  }
});
socket.on("user-disconnected", ({name}) => {
  if (name === selectedUser) showToast(`${name} disconnected.`);
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
  meta.textContent = `${from} · ${new Date(time || Date.now()).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}`;
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
  socket.emit("chat-message", {to:selectedUser, message});
  addMessage(myName, message, Date.now(), true);
  $("messageInput").value = "";
});
$("emojiBtn").addEventListener("click", () => {
  $("messageInput").value += " 😊";
  $("messageInput").focus();
});
socket.on("chat-message", ({from,message,time}) => {
  if (from !== selectedUser) showToast(`New message from ${from}`);
  if (from === selectedUser) addMessage(from,message,time,false);
});
socket.on("message-sent", () => {});

// ===== WebRTC =====
async function getMedia(video) {
  return navigator.mediaDevices.getUserMedia({
    audio: {echoCancellation:true, noiseSuppression:true, autoGainControl:true},
    video: video ? {facingMode:"user"} : false
  });
}
function createPeer(remoteName) {
  peerConnection = new RTCPeerConnection(config);
  pendingCandidates = [];
  peerConnection.ontrack = (event) => {
    $("remoteVideo").srcObject = event.streams[0];
    $("remotePlaceholder").hidden = true;
    $("remoteVideo").play().catch(()=>{});
  };
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) socket.emit("candidate", {to:remoteName,candidate:event.candidate});
  };
  peerConnection.onconnectionstatechange = () => {
    const state = peerConnection?.connectionState;
    if (state === "connected") setCallStatus("Connected · encrypted peer connection");
    if (state === "disconnected") setCallStatus("Connection interrupted…");
    if (state === "failed") setCallStatus("Connection failed. A TURN server may be needed.");
  };
  if (localStream) localStream.getTracks().forEach(track => peerConnection.addTrack(track,localStream));
}
async function startCall(type) {
  if (!selectedUser) return showToast("Choose an online person first.");
  if (peerConnection) return showToast("You are already in a call.");
  try {
    callType = type;
    localStream = await getMedia(type === "video");
    $("localVideo").srcObject = localStream;
    openCallPanel(selectedUser);
    createPeer(selectedUser);
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit("offer",{to:selectedUser,offer,callType:type});
    setCallStatus("Calling… waiting for answer");
  } catch (err) {
    cleanupCall(false);
    showToast(err.name === "NotAllowedError" ? "Allow camera/microphone access in your browser." : `Call error: ${err.message}`);
  }
}
$("audioCallBtn").addEventListener("click",()=>startCall("audio"));
$("videoCallBtn").addEventListener("click",()=>startCall("video"));

function openCallPanel(name) {
  $("callPanel").hidden = false;
  $("remoteCallName").textContent = name;
  $("remoteAvatar").textContent = initials(name);
  $("remotePlaceholder").hidden = false;
}
socket.on("offer", ({offer,from,callType:type}) => {
  if (peerConnection) {
    socket.emit("reject-call",{to:from});
    return;
  }
  incomingOffer = offer;
  caller = from;
  incomingCallType = type || "video";
  $("callerName").textContent = `${from} is calling`;
  $("incomingType").textContent = incomingCallType.toUpperCase();
  $("incomingCall").hidden = false;
});
$("acceptBtn").addEventListener("click",acceptCall);
async function acceptCall() {
  if (!incomingOffer || !caller) return;
  $("incomingCall").hidden = true;
  try {
    callType = incomingCallType;
    localStream = await getMedia(callType === "video");
    $("localVideo").srcObject = localStream;
    openCallPanel(caller);
    createPeer(caller);
    await peerConnection.setRemoteDescription(incomingOffer);
    await flushCandidates();
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit("answer",{to:caller,answer});
    setCallStatus("Answer sent · connecting");
    selectedUser = caller;
    updateSelectedUser();
    renderPeople();
  } catch (err) {
    showToast(`Could not answer: ${err.message}`);
    cleanupCall(false);
  } finally {
    incomingOffer = null;
  }
}
$("rejectBtn").addEventListener("click",()=>{
  if (caller) socket.emit("reject-call",{to:caller});
  $("incomingCall").hidden = true;
  incomingOffer = null;
  caller = "";
});
socket.on("answer",async ({answer})=>{
  if (!peerConnection) return;
  try {
    await peerConnection.setRemoteDescription(answer);
    await flushCandidates();
    setCallStatus("Answer received · connecting");
  } catch(err) { showToast(`Answer error: ${err.message}`); }
});
socket.on("candidate",async ({candidate})=>{
  if (!candidate || !peerConnection) return;
  try {
    if (peerConnection.remoteDescription) await peerConnection.addIceCandidate(candidate);
    else pendingCandidates.push(candidate);
  } catch(err) { console.warn("ICE candidate error",err); }
});
async function flushCandidates() {
  const list = pendingCandidates.splice(0);
  for (const candidate of list) {
    try { await peerConnection.addIceCandidate(candidate); } catch(err) { console.warn(err); }
  }
}
socket.on("call-rejected",({from})=>{
  showToast(`${from} declined the call.`);
  cleanupCall(false);
});
socket.on("end-call",({from})=>{
  showToast(`${from} ended the call.`);
  cleanupCall(false);
});
$("endCallBtn").addEventListener("click",()=>{
  const other = caller || selectedUser;
  if (other) socket.emit("end-call",{to:other});
  cleanupCall(false);
});
function cleanupCall(notify=false) {
  if (notify) {
    const other = caller || selectedUser;
    if (other) socket.emit("end-call",{to:other});
  }
  if (peerConnection) { peerConnection.ontrack=null; peerConnection.close(); peerConnection=null; }
  if (localStream) { localStream.getTracks().forEach(t=>t.stop()); localStream=null; }
  $("localVideo").srcObject=null;
  $("remoteVideo").srcObject=null;
  $("callPanel").hidden=true;
  $("remotePlaceholder").hidden=false;
  $("muteBtn").classList.remove("active");
  $("cameraBtn").classList.remove("active");
  caller="";
  incomingOffer=null;
  pendingCandidates=[];
}
$("muteBtn").addEventListener("click",()=>{
  const track=localStream?.getAudioTracks()[0];
  if (!track) return showToast("No microphone track.");
  track.enabled=!track.enabled;
  $("muteBtn").classList.toggle("active",!track.enabled);
  $("muteBtn").textContent=track.enabled?"🎙":"🔇";
});
$("cameraBtn").addEventListener("click",()=>{
  const track=localStream?.getVideoTracks()[0];
  if (!track) return showToast("This is an audio-only call.");
  track.enabled=!track.enabled;
  $("cameraBtn").classList.toggle("active",!track.enabled);
});
$("flipBtn").addEventListener("click",async()=>{
  if (!localStream || callType!=="video") return showToast("Camera is not active.");
  try {
    const old=localStream.getVideoTracks()[0];
    const settings=old.getSettings();
    const devices=await navigator.mediaDevices.enumerateDevices();
    const cameras=devices.filter(d=>d.kind==="videoinput");
    if(cameras.length<2) return showToast("No second camera found.");
    const index=cameras.findIndex(d=>d.deviceId===settings.deviceId);
    const next=cameras[(index+1)%cameras.length];
    const stream=await navigator.mediaDevices.getUserMedia({video:{deviceId:{exact:next.deviceId}},audio:false});
    const newTrack=stream.getVideoTracks()[0];
    const sender=peerConnection?.getSenders().find(s=>s.track?.kind==="video");
    if(sender) await sender.replaceTrack(newTrack);
    localStream.removeTrack(old); old.stop(); localStream.addTrack(newTrack);
    $("localVideo").srcObject=localStream;
  } catch(err){showToast(`Camera switch failed: ${err.message}`);}
});
$("fullscreenBtn").addEventListener("click",()=>{
  const target=$("remoteVideo");
  if(!document.fullscreenElement) target.requestFullscreen?.().catch(()=>{});
  else document.exitFullscreen?.();
});
$("minimizeCall").addEventListener("click",()=>{$("callPanel").hidden=true;showToast("Call minimized. Use the call controls to end it.");});
// Keep a small floating call panel visible after minimizing; restore from top actions
$("audioCallBtn").addEventListener("dblclick",()=>{$("callPanel").hidden=false;});
$("videoCallBtn").addEventListener("dblclick",()=>{$("callPanel").hidden=false;});
window.addEventListener("beforeunload",()=>{if(peerConnection)socket.emit("end-call",{to:caller||selectedUser});});
