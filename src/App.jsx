import { useRef, useState } from "react";
import "./App.css";

const WS_URL = import.meta.env.VITE_WS_URL;

function App() {
  const [status, setStatus] = useState("Disconnected");
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [cartItems, setCartItems] = useState([]);
  const [isSpeakingUI, setIsSpeakingUI] = useState(false); // UI 표시용
  const [speechQueue, setSpeechQueue] = useState([]);

  const socketRef = useRef(null);
  const audioContextRef = useRef(null);
  const streamRef = useRef(null);

  // 🔥 [핵심] 리액트 상태 지연을 피하기 위해 Ref를 사용합니다.
  // 이 값은 수정 즉시 startRecording 로직에 반영됩니다.
  const isSpeakingRef = useRef(false);

  const speak = (text) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "ko-KR";
    utterance.rate = 0.9;

    utterance.onstart = () => {
      isSpeakingRef.current = true;
      setIsSpeakingUI(true);
    };

    utterance.onend = () => {
      // 음성이 끝났을 때만 1.5초 뒤에 방어막을 해제합니다.
      setTimeout(() => {
        // 🚨 현재 재생 중인 다른 음성이 없을 때만 마이크를 엽니다.
        if (!window.speechSynthesis.speaking) {
          isSpeakingRef.current = false;
          setIsSpeakingUI(false);
        }
      }, 1500);
    };

    window.speechSynthesis.speak(utterance);
  };

  const connectWebSocket = () => {
    socketRef.current = new WebSocket(WS_URL);
    socketRef.current.onopen = () => setStatus("✅ 서버와 연결되었습니다!");

    socketRef.current.onmessage = (event) => {
      const message = event.data;
      console.log("📩 서버 메시지 수신:", message);

      // 일반 자막(STT 결과)만 방어막으로 거르고, SYSTEM 메시지는 무조건 통과시킵니다.
      if (!message.startsWith("SYSTEM:") && isSpeakingRef.current) {
        return;
      }

      // 주문 성공 처리 (기존 로직 유지)
      if (message.startsWith("SYSTEM:ORDER_SUCCESS:")) {
        // 2️⃣ [방어막 2] 성공 메시지 받자마자 즉시 Ref 잠금

        const [, , menuName, quantity] = message.split(":");
        setTranscript(`✅ 주문 성공: ${menuName} ${quantity}개`);

        setCartItems((prev) => [
          ...prev,
          {
            name: menuName,
            qty: quantity,
            time: new Date().toLocaleTimeString(),
          },
        ]);

        speak(`${menuName} ${quantity}개가 담겼습니다.`);
      }
      // 취소 성공 처리 (SYSTEM:CANCEL_SUCCESS)
      else if (message.startsWith("SYSTEM:CANCEL_SUCCESS:")) {
        const parts = message.split(":");
        const menuName = parts[2];
        const cancelQty = parts[3]; // "1" 혹은 "ALL"

        setTranscript(
          `🗑️ 취소: ${menuName} ${cancelQty === "ALL" ? "전체" : cancelQty + "개"}`,
        );

        if (cancelQty === "ALL") {
          setCartItems((prev) => prev.filter((item) => item.name !== menuName));
          speak(`${menuName} 전체 취소가 완료되었습니다.`);
        } else {
          setCartItems(
            (prev) =>
              prev
                .map((item) =>
                  item.name === menuName
                    ? {
                        ...item,
                        qty: Math.max(0, item.qty - parseInt(cancelQty)),
                      }
                    : item,
                )
                .filter((item) => item.qty > 0), // 0개가 되면 목록에서 제거
          );
          speak(`${menuName} ${cancelQty}개 취소되었습니다.`);
        }
      } else if (message.startsWith("SYSTEM:REASK_QUANTITY:")) {
        const menuName = message.split(":")[2];
        // 팝업창으로 수량 입력 받기 (음성 인식이 미흡할 때를 대비한 백업)
        const userQty = window.prompt(
          `🛒 ${menuName} 수량을 입력해 주세요 (1~10):`,
          "1",
        );

        if (userQty) {
          speak(`${menuName} ${userQty}개가 담겼습니다.`);
          setCartItems((prev) => [
            ...prev,
            {
              name: menuName,
              qty: userQty,
              time: new Date().toLocaleTimeString(),
            },
          ]);
        }
      } else {
        if (!isSpeakingRef.current) setTranscript(message);
      }
    };
  };

  const startRecording = async () => {
    if (socketRef.current?.readyState !== WebSocket.OPEN)
      return alert("연결 확인!");

    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      audioContextRef.current = new (
        window.AudioContext || window.webkitAudioContext
      )({ sampleRate: 16000 });

      const source = audioContextRef.current.createMediaStreamSource(
        streamRef.current,
      );
      await audioContextRef.current.audioWorklet.addModule(
        "/AudioProcessor.js",
      );
      const workletNode = new AudioWorkletNode(
        audioContextRef.current,
        "audio-processor",
      );

      workletNode.port.onmessage = (event) => {
        // 🔥 [핵심 로직] useState가 아닌 isSpeakingRef.current를 체크합니다.
        // 안내 중이면 백엔드로 오디오 데이터를 0.1%도 보내지 않습니다.
        if (
          socketRef.current.readyState === WebSocket.OPEN &&
          !isSpeakingRef.current
        ) {
          socketRef.current.send(event.data);
        }
      };

      source.connect(workletNode);
      workletNode.connect(audioContextRef.current.destination);
      setIsRecording(true);
    } catch (e) {
      console.error(e);
    }
  };

  const stopRecording = () => {
    if (audioContextRef.current) audioContextRef.current.close();
    if (streamRef.current)
      streamRef.current.getTracks().forEach((t) => t.stop());
    setIsRecording(false);
  };

  return (
    <div className="App" style={{ padding: "20px", textAlign: "center" }}>
      <h1>🎙️ 음성 인식 중복 방지 (Ref 강화 버전)</h1>
      <p>
        상태: <strong>{status}</strong>{" "}
        {isSpeakingUI && (
          <span style={{ color: "red" }}>(안내 중 - 마이크 차단됨)</span>
        )}
      </p>

      {/* ... 이하 UI 동일 ... */}
      <div style={{ marginBottom: "20px" }}>
        <button onClick={connectWebSocket}>1. 서버 연결</button>
        <button onClick={startRecording} disabled={isRecording}>
          2. 주문 시작
        </button>
        <button onClick={stopRecording} disabled={!isRecording}>
          3. 주문 종료
        </button>
      </div>
      <div style={{ display: "flex", justifyContent: "center", gap: "20px" }}>
        <div
          style={{
            width: "45%",
            border: "2px solid #007bff",
            padding: "15px",
            minHeight: "200px",
          }}
        >
          <h3>👂 인식된 내용</h3>
          <p style={{ fontSize: "1.4rem", color: "#007bff" }}>{transcript}</p>
        </div>
        <div
          style={{
            width: "45%",
            border: "2px solid #28a745",
            padding: "15px",
            minHeight: "200px",
          }}
        >
          <h3>🛒 장바구니</h3>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {cartItems.map((item, i) => (
              <li
                key={i}
                style={{ borderBottom: "1px dotted #ccc", padding: "5px" }}
              >
                {item.name} - {item.qty}개 ({item.time})
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export default App;
