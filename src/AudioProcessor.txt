// src/AudioProcessor.js
class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // 들어오는 Float32 오디오 데이터를 PCM(LINEAR16) 바이트 배열로 변환하는 버퍼
    this.buffer = [];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input.length > 0) {
      const channelData = input[0]; // 모노 채널 데이터 (Float32Array)

      // Float32 데이터를 LINEAR16 (PCM) 포맷으로 변환
      const pcmData = this.float32ToInt16(channelData);

      // 변환된 데이터를 메인 스레드(App.jsx)로 전송
      this.port.postMessage(pcmData.buffer);
    }
    return true; // 계속 처리
  }

  // Float32 (브라우저 기본) 데이터를 Int16 (LINEAR16, 구글 STT 규격)으로 변환하는 유틸리티
  float32ToInt16(float32Array) {
    let pcmArray = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      let s = Math.max(-1, Math.min(1, float32Array[i]));
      // 32767을 곱해서 Int16 범위로 변환
      pcmArray[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return pcmArray;
  }
}

registerProcessor("audio-processor", AudioProcessor);
