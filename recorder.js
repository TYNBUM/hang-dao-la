'use strict';
// Browser-native capture; each attempt owns and releases all of its streams.
class LocalRecorder {
  constructor(onState, onResult, onError) {
    this.onState = onState; this.onResult = onResult; this.onError = onError;
    this.phase = 'idle'; this.streams = []; this.elapsed = 0;
  }
  update(phase) { this.phase = phase; this.onState(phase); }
  async start(mode, microphone, systemAudio) {
    if (this.phase !== 'idle') return;
    this.update('starting'); this.elapsed = 0; this.mode = mode; this.chunks = [];
    try {
      if (!window.isSecureContext || !navigator.mediaDevices || !window.MediaRecorder) throw new Error('请使用 HTTPS 或 localhost，在支持录制的浏览器中打开。');
      let display, mic;
      if (mode === 'screen') {
        if (!navigator.mediaDevices.getDisplayMedia) throw new Error('当前浏览器不支持录屏，请在桌面 Chrome / Edge 中打开。');
        // This call must remain before any await that would lose user activation.
        display = await navigator.mediaDevices.getDisplayMedia({video: {frameRate: 30}, audio: systemAudio});
        this.streams.push(display);
      }
      if (mode === 'audio' || microphone) {
        mic = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true}, video: false});
        this.streams.push(mic);
      }
      if (display && display.getVideoTracks()[0]?.readyState !== 'live') throw new Error('屏幕共享已结束，请重新开始。');
      const audioTracks = this.streams.flatMap(stream => stream.getAudioTracks());
      let outputAudio = audioTracks;
      if (audioTracks.length > 1) {
        this.context = new AudioContext();
        await this.context.resume();
        const destination = this.context.createMediaStreamDestination();
        for (const track of audioTracks) this.context.createMediaStreamSource(new MediaStream([track])).connect(destination);
        outputAudio = destination.stream.getAudioTracks(); this.streams.push(destination.stream);
      }
      this.hasMic = !!mic?.getAudioTracks().length;
      this.hasSystem = !!display?.getAudioTracks().length;
      this.output = new MediaStream([...(display?.getVideoTracks() || []), ...outputAudio]);
      const types = mode === 'audio' ? ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'] : ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
      const mimeType = types.find(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(this.output, mimeType ? {mimeType} : {});
      this.recorder = recorder;
      recorder.ondataavailable = event => { if (event.data.size) this.chunks.push(event.data); };
      recorder.onerror = () => { this.onError('录制出现错误，正在保留已录制内容。'); this.stop(); };
      recorder.onstop = () => {
        const blob = new Blob(this.chunks, {type: recorder.mimeType || this.chunks[0]?.type || (mode === 'audio' ? 'audio/webm' : 'video/webm')});
        this.chunks = []; this.cleanup(); this.update('idle');
        if (blob.size) this.onResult(blob, mode, this.elapsed);
        else this.onError('没有生成有效录制内容，请重新录制。');
      };
      display?.getVideoTracks()[0]?.addEventListener('ended', () => this.stop(), {once: true});
      mic?.getAudioTracks()[0]?.addEventListener('ended', () => { this.onError('麦克风已断开，已结束并保留录制。'); this.stop(); }, {once: true});
      recorder.start(1000); this.startedAt = performance.now(); this.update('recording');
    } catch (error) {
      this.cleanup(); this.update('idle');
      const messages = {NotAllowedError: '未获得录制授权或已取消。点击开始可重新选择。', NotFoundError: '没有找到麦克风，请连接麦克风，或关闭解说后录屏。', NotReadableError: '无法读取录制设备，请检查设备占用和系统权限。'};
      this.onError(messages[error.name] || error.message || '暂时无法开始录制。');
    }
  }
  duration() { return this.elapsed + (this.phase === 'recording' ? performance.now() - this.startedAt : 0); }
  pause() {
    if (this.phase === 'recording') {
      this.elapsed = this.duration(); this.recorder.pause(); this.update('paused');
    } else if (this.phase === 'paused') {
      this.recorder.resume(); this.startedAt = performance.now(); this.update('recording');
    }
  }
  stop() {
    if (!['recording', 'paused'].includes(this.phase)) return;
    this.elapsed = this.duration(); this.update('stopping');
    if (this.recorder.state !== 'inactive') this.recorder.stop();
  }
  cleanup() {
    for (const stream of this.streams) stream.getTracks().forEach(track => track.stop());
    this.streams = []; this.output?.getTracks().forEach(track => track.stop()); this.output = null;
    if (this.context) { this.context.close().catch(() => {}); this.context = null; }
    this.recorder = null;
  }
}
