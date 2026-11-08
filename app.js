(() => {
  "use strict";
  const CHANNELS = [
    ["POLICE 1","01","Main police dispatch"],["POLICE 2","02","Police operations"],
    ["POLICE 3","03","Police secondary"],["SHERIFF 1","04","Sheriff dispatch"],
    ["SHERIFF 2","05","Sheriff operations"],["FIRE 1","06","Fire dispatch"],
    ["FIRE 2","07","Fire operations"],["EMS 1","08","Medical dispatch"],
    ["EMS 2","09","Medical operations"],["DISPATCH","10","Central communications"],
    ["TRAFFIC","11","Traffic operations"],["AIR SUPPORT","12","Air unit communications"]
  ].map(([name,number,description])=>({name,number,description}));

  const $ = id => document.getElementById(id);
  const socket = io({ autoConnect: false, reconnection: true });
  const state = {
    joined:false, name:"", active:"POLICE 1", muted:new Set(), allMuted:false,
    microphone:null, tracks:new Map(), peers:new Map(), audioElements:new Map(),
    roster:new Map(), volume:.8, transmitting:false, pendingIce:new Map()
  };

  function addLog(message) {
    const row=document.createElement("div"); row.className="activity-item";
    const time=document.createElement("time"); time.textContent=new Date().toLocaleTimeString();
    const text=document.createElement("span"); text.textContent=message;
    row.append(time,text); $("activityList").prepend(row);
  }
  function setConnection(online) {
    $("connectionDot").classList.toggle("online",online);
    $("connectionText").textContent=online?"CONNECTED":"DISCONNECTED";
    $("networkDot").classList.toggle("online",online);
    $("networkStatus").textContent=online?"ONLINE":"OFFLINE";
  }
  function channelColor(name) {
    if(name.startsWith("POLICE"))return "#347ec0";
    if(name.startsWith("SHERIFF"))return "#3296a8";
    if(name.startsWith("FIRE"))return "#d45c55";
    if(name.startsWith("EMS"))return "#35a879";
    if(name==="DISPATCH")return "#9272c6";
    if(name==="TRAFFIC")return "#d59b43";
    return "#45a7a2";
  }
  function renderChannels() {
    const grid=$("channelGrid"); grid.replaceChildren();
    CHANNELS.forEach(channel=>{
      const selected=state.active===channel.name, muted=state.muted.has(channel.name);
      const card=document.createElement("div");
      card.className="channel-card"+(selected?" selected":"")+(muted?" is-muted":"");
      const select=document.createElement("button"); select.type="button";
      select.className="channel-select"; select.style.cssText="display:block;width:100%;text-align:left;background:none;border:0;color:inherit;padding:0;cursor:pointer";
      const top=document.createElement("div");top.className="channel-top";
      const name=document.createElement("span");name.className="channel-name";name.textContent=channel.name;
      name.style.borderLeft=`3px solid ${channelColor(channel.name)}`;name.style.paddingLeft="7px";
      const number=document.createElement("span");number.className="channel-number";number.textContent="CH "+channel.number;
      top.append(name,number);
      const desc=document.createElement("div");desc.className="channel-description";desc.textContent=channel.description;
      const stateText=document.createElement("div");stateText.className="channel-state";stateText.textContent=muted?"INCOMING MUTED":selected?"SELECTED TO TRANSMIT":"MONITORING";
      select.append(top,desc,stateText);
      select.addEventListener("click",()=>selectChannel(channel.name));
      const bottom=document.createElement("div");bottom.className="channel-bottom";
      const hint=document.createElement("span");hint.className="channel-state";hint.textContent=selected?"TX CHANNEL":"RX AUDIO";
      const mute=document.createElement("button");mute.type="button";mute.className="mute-button";
      mute.textContent=muted?"🔇 UNMUTE":"🔊 MUTE";mute.setAttribute("aria-label",(muted?"Unmute ":"Mute ")+channel.name);
      mute.addEventListener("click",()=>toggleMute(channel.name));
      bottom.append(hint,mute);card.append(select,bottom);grid.append(card);
    });
    $("mutedCount").textContent=state.muted.size;
    $("activeFrequency").textContent=state.active;
    $("txFrequency").textContent=state.active;
    $("muteAllButton").disabled=state.muted.size===CHANNELS.length;
    $("unmuteAllButton").disabled=state.muted.size===0;
  }
  function selectChannel(name) {
    state.active=name;
    if(state.transmitting) stopTransmit();
    $("pttTitle").textContent="READY TO TRANSMIT";
    renderChannels();addLog("Transmit frequency selected: "+name);
  }
  function toggleMute(name) {
    if(state.muted.has(name))state.muted.delete(name);else state.muted.add(name);
    if(name===state.active&&state.transmitting)stopTransmit();
    applyAudioMute();renderChannels();addLog(name+(state.muted.has(name)?" incoming audio muted.":" incoming audio unmuted."));
  }
  function applyAudioMute() {
    for(const [key,audio] of state.audioElements.entries()){
      const channel=key.split("::")[1];
      audio.muted=state.muted.has(channel);
      audio.volume=state.volume;
    }
    $("mutedCount").textContent=state.muted.size;
  }
  function renderRoster() {
    const list=$("rosterList");list.replaceChildren();
    for(const [id,name] of state.roster){
      const li=document.createElement("li");li.textContent=name+(id===socket.id?" (YOU)":"");list.append(li);
    }
    $("onlineCount").textContent=state.roster.size;
    $("rosterCount").textContent=state.roster.size+" ONLINE";
  }

  async function ensureMicrophone() {
    if(state.microphone?.active)return true;
    if(!navigator.mediaDevices?.getUserMedia)throw new Error("Microphone requires HTTPS or localhost and a supported browser.");
    state.microphone=await navigator.mediaDevices.getUserMedia({audio:{
      echoCancellation:true,noiseSuppression:true,autoGainControl:true
    }});
    state.microphone.getAudioTracks().forEach(track=>track.enabled=false);
    for(const [key,pc] of state.peers){
      const channel=key.split("::")[1];
      const sender=pc.getSenders().find(s=>s.track?.kind==="audio") ||
        pc.getTransceivers().find(t=>t.receiver.track.kind==="audio")?.sender;
      if(sender){
        const clone=state.microphone.getAudioTracks()[0].clone();
        clone.enabled=false;
        await sender.replaceTrack(clone);
        state.tracks.set(key,clone);
      }
    }
    $("micStatus").textContent="MICROPHONE READY";
    $("micSetup").textContent="MIC ENABLED";
    addLog("Microphone permission granted.");
    return true;
  }

  function pcKey(peerId,channel){return peerId+"::"+channel;}
  function getPeerConnection(peerId,channel,peerName="Dispatcher") {
    const key=pcKey(peerId,channel);
    if(state.peers.has(key))return state.peers.get(key);
    const pc=new RTCPeerConnection({
      iceServers:[
        {urls:"stun:stun.l.google.com:19302"},
        {urls:"stun:stun1.l.google.com:19302"}
      ]
    });
    pc.addTransceiver("audio",{direction:"sendrecv"});
    pc.onicecandidate=event=>{
      if(event.candidate)socket.emit("rtc-signal",{target:peerId,channel,candidate:event.candidate});
    };
    pc.ontrack=event=>{
      const audioKey=pcKey(peerId,channel);
      let audio=state.audioElements.get(audioKey);
      if(!audio){
        audio=document.createElement("audio");audio.autoplay=true;audio.playsInline=true;
        audio.dataset.peer=peerId;audio.dataset.channel=channel;
        document.body.append(audio);state.audioElements.set(audioKey,audio);
      }
      if(event.streams[0])audio.srcObject=event.streams[0];
      audio.muted=state.muted.has(channel);audio.volume=state.volume;
      audio.play().catch(()=>addLog("Tap the page once if your browser blocks incoming audio."));
    };
    pc.onconnectionstatechange=()=>{
      if(pc.connectionState==="failed"||pc.connectionState==="closed")removePeer(peerId,channel);
    };
    state.peers.set(key,pc);
    // If the microphone has already been enabled, attach a silent per-frequency
    // clone. Only the selected channel's clone is enabled while PTT is held.
    if(state.microphone?.active){
      const clone=state.microphone.getAudioTracks()[0].clone();clone.enabled=false;
      const sender=pc.getSenders().find(s=>s.track?.kind==="audio")||
        pc.getTransceivers().find(t=>t.receiver.track.kind==="audio")?.sender;
      if(sender)sender.replaceTrack(clone);
      state.tracks.set(key,clone);
    }
    return pc;
  }

  async function createOffer(peerId,channel,peerName) {
    const pc=getPeerConnection(peerId,channel,peerName);
    try{
      const offer=await pc.createOffer();await pc.setLocalDescription(offer);
      socket.emit("rtc-signal",{target:peerId,channel,description:pc.localDescription});
    }catch(error){console.error("Offer error",error);addLog("Could not connect to "+peerName+" on "+channel+".");}
  }
  async function handleSignal(message) {
    const {from,channel,description,candidate,fromName}=message;
    const pc=getPeerConnection(from,channel,fromName);
    try{
      if(description){
        await pc.setRemoteDescription(description);
        const queued=state.pendingIce.get(pcKey(from,channel))||[];
        for(const ice of queued)await pc.addIceCandidate(ice);
        state.pendingIce.delete(pcKey(from,channel));
        if(description.type==="offer"){
          const answer=await pc.createAnswer();await pc.setLocalDescription(answer);
          socket.emit("rtc-signal",{target:from,channel,description:pc.localDescription});
        }
      }else if(candidate){
        if(pc.remoteDescription)await pc.addIceCandidate(candidate);
        else{
          const key=pcKey(from,channel);
          if(!state.pendingIce.has(key))state.pendingIce.set(key,[]);
          state.pendingIce.get(key).push(candidate);
        }
      }
    }catch(error){console.error("Signaling error",error);}
  }
  function removePeer(peerId,channel) {
    const key=pcKey(peerId,channel);
    const pc=state.peers.get(key);if(pc){pc.close();state.peers.delete(key);}
    const track=state.tracks.get(key);if(track){track.stop();state.tracks.delete(key);}
    const audio=state.audioElements.get(key);if(audio){audio.pause();audio.srcObject=null;audio.remove();state.audioElements.delete(key);}
    state.pendingIce.delete(key);
  }

  async function startTransmit() {
    if(!state.joined||state.transmitting||state.muted.has(state.active))return;
    try{
      await ensureMicrophone();
      // A channel-specific cloned track prevents voice leaking into other frequencies.
      for(const [key,track] of state.tracks){
        const channel=key.split("::")[1];track.enabled=channel===state.active;
      }
      state.transmitting=true;
      $("pttButton").classList.add("transmitting");
      $("pttIcon").textContent="●";
      $("pttTitle").textContent="TRANSMITTING";
      $("pttHelp").textContent="Release the button to stop speaking";
      $("txBadge").textContent="LIVE";$("txBadge").classList.add("live");
      socket.emit("transmitting",{channel:state.active,active:true});
      addLog("Transmitting on "+state.active+".");
    }catch(error){
      $("pttHelp").textContent=error.message||"Microphone permission was not granted.";
      addLog("Microphone unavailable: "+(error.message||"permission denied"));
    }
  }
  function stopTransmit() {
    if(!state.transmitting)return;
    for(const track of state.tracks.values())track.enabled=false;
    socket.emit("transmitting",{channel:state.active,active:false});
    state.transmitting=false;
    $("pttButton").classList.remove("transmitting");$("pttIcon").textContent="⚡";
    $("pttTitle").textContent="READY TO TRANSMIT";$("pttHelp").textContent="Hold the button to speak";
    $("txBadge").textContent="STANDBY";$("txBadge").classList.remove("live");
    addLog("Transmission ended.");
  }
  function cleanup() {
    stopTransmit();
    for(const key of [...state.peers.keys()]){
      const [peerId,channel]=key.split("::");removePeer(peerId,channel);
    }
    if(state.microphone){state.microphone.getTracks().forEach(t=>t.stop());state.microphone=null;}
  }

  $("joinForm").addEventListener("submit",event=>{
    event.preventDefault();
    $("joinError").textContent="";$("joinButton").disabled=true;$("joinButton").textContent="CONNECTING…";
    state.name=$("nameInput").value.trim();
    socket.connect();
    const onConnect=()=>{
      socket.emit("join-radio",{name:state.name,roomCode:$("codeInput").value},result=>{
        $("joinButton").disabled=false;$("joinButton").innerHTML='CONNECT TO RADIO <span>→</span>';
        if(!result?.ok){$("joinError").textContent=result?.error||"Unable to join radio.";socket.disconnect();return;}
        state.joined=true;$("joinScreen").classList.add("hidden");$("radioApp").classList.remove("hidden");
        setConnection(true);addLog("Connected to the private radio network.");
      });
    };
    socket.once("connect",onConnect);
    socket.once("connect_error",err=>{$("joinButton").disabled=false;$("joinButton").innerHTML='CONNECT TO RADIO <span>→</span>';$("joinError").textContent="Connection failed: "+err.message;});
  });

  socket.on("channel-peers",({channel,peers})=>{
    peers.forEach(peer=>{
      getPeerConnection(peer.id,channel,peer.name);
      // Deterministic offerer prevents both clients creating offers at once.
      if(socket.id.localeCompare(peer.id)<0)createOffer(peer.id,channel,peer.name);
    });
  });
  socket.on("peer-joined",({channel,peer})=>{
    getPeerConnection(peer.id,channel,peer.name);
    if(socket.id.localeCompare(peer.id)<0)createOffer(peer.id,channel,peer.name);
    addLog(peer.name+" connected to "+channel+".");
  });
  socket.on("rtc-signal",handleSignal);
  socket.on("peer-left",({id,channel})=>removePeer(id,channel));
  socket.on("roster-update",roster=>{
    state.roster=new Map(roster.map(user=>[user.id,user.name]));renderRoster();
  });
  socket.on("radio-log",entry=>addLog(entry.message));
  socket.on("transmitter-state",entry=>{
    if(entry.active)addLog(entry.name+" is transmitting on "+entry.channel+".");
    else addLog(entry.name+" stopped transmitting on "+entry.channel+".");
  });
  socket.on("disconnect",()=>{
    setConnection(false);
    if(state.joined){cleanup();addLog("Connection to radio server lost.");}
  });
  socket.on("connect",()=>setConnection(true));

  $("pttButton").addEventListener("pointerdown",event=>{event.preventDefault();startTransmit();});
  ["pointerup","pointercancel","pointerleave"].forEach(type=>$("pttButton").addEventListener(type,stopTransmit));
  window.addEventListener("blur",stopTransmit);
  document.addEventListener("visibilitychange",()=>{if(document.hidden)stopTransmit();});
  $("micSetup").addEventListener("click",async()=>{
    try{await ensureMicrophone();}catch(error){$("pttHelp").textContent=error.message;}
  });
  $("volumeSlider").addEventListener("input",event=>{
    state.volume=Number(event.target.value)/100;$("volumeValue").textContent=event.target.value+"%";applyAudioMute();
  });
  $("muteAllButton").addEventListener("click",()=>{
    state.muted=new Set(CHANNELS.map(c=>c.name));if(state.transmitting)stopTransmit();
    renderChannels();applyAudioMute();addLog("All incoming frequencies muted.");
  });
  $("unmuteAllButton").addEventListener("click",()=>{
    state.muted.clear();renderChannels();applyAudioMute();addLog("All incoming frequencies unmuted.");
  });
  $("clearLog").addEventListener("click",()=>$("activityList").replaceChildren());
  $("disconnectButton").addEventListener("click",()=>{
    cleanup();state.joined=false;state.roster.clear();renderRoster();
    socket.disconnect();$("radioApp").classList.add("hidden");$("joinScreen").classList.remove("hidden");
    $("codeInput").value="";setConnection(false);addLog("Disconnected.");
  });

  function updateClock(){$("clock").textContent=new Date().toLocaleTimeString();}
  updateClock();setInterval(updateClock,1000);renderChannels();
})();
