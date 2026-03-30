import { useRef, useState } from "react";
import "./App.css";

const WS_URL = import.meta.env.VITE_WS_URL;

function App() {
  const [status, setStatus] = useState("Disconnected");
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [cartItems, setCartItems] = useState([]);

  const socketRef = useRef(null);
  const audioContextRef = useRef(null);
  const streamRef = useRef(null);

  const connectWebSocket = () => {
    socketRef.current = new WebSocket(WS_URL);

    socketRef.current.onopen = () => setStatus("✅ 서버와 연결되었습니다!");

    socketRef.current.onmessage = (event) => {
      const message = event.data;

      // 1. 🔥 주문 성공 (메뉴명 + 수량)
      if (message.startsWith("SYSTEM:ORDER_SUCCESS:")) {
        const [, , menuName, quantity] = message.split(":");
        console.log(`🛒 장바구니 추가 완료: ${menuName} ${quantity}개`);

        setCartItems((prev) => [
          ...prev,
          {
            name: menuName,
            qty: quantity,
            time: new Date().toLocaleTimeString(),
          },
        ]);
        alert(`✅ ${menuName} ${quantity}개가 장바구니에 담겼습니다!`);
      }

      // 2. 🔥 '많이' 등 모호한 표현 대응 (되묻기)
      else if (message.startsWith("SYSTEM:REASK_QUANTITY:")) {
        const menuName = message.split(":")[2];
        alert(`🤔 "${menuName}"을 얼마나 많이 드릴까요?`);

        // 테스트용: prompt로 숫자를 직접 입력받음
        const userQty = window.prompt(
          "원하시는 숫자를 입력해 주세요 (1~10):",
          "1",
        );
        if (userQty) {
          alert(
            `확인되었습니다. ${menuName} ${userQty}개를 수동으로 추가합니다.`,
          );
          setCartItems((prev) => [
            ...prev,
            {
              name: menuName,
              qty: userQty,
              time: new Date().toLocaleTimeString(),
            },
          ]);
        }
      }

      // 3. 🔥 수량이 언급되지 않았을 때 (수량 입력창)
      else if (message.startsWith("SYSTEM:NEED_QUANTITY:")) {
        const menuName = message.split(":")[2];
        const userQty = window.prompt(
          `🛒 ${menuName} 몇 개를 주문하시겠어요? (1~10):`,
          "1",
        );

        if (userQty) {
          alert(
            `확인되었습니다. ${menuName} ${userQty}개를 장바구니에 담습니다.`,
          );
          setCartItems((prev) => [
            ...prev,
            {
              name: menuName,
              qty: userQty,
              time: new Date().toLocaleTimeString(),
            },
          ]);
        }
      }

      // 4. 일반 실시간 인식 텍스트
      else {
        setTranscript(message);
      }
    };

    socketRef.current.onerror = (error) => setStatus("❌ 에러 발생");
    socketRef.current.onclose = () => setStatus("🔒 연결 종료됨");
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
        if (socketRef.current.readyState === WebSocket.OPEN) {
          socketRef.current.send(event.data);
        }
      };

      source.connect(workletNode);
      workletNode.connect(audioContextRef.current.destination);
      setIsRecording(true);
      setTranscript("");
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
      <h1>🎙️ 음성 주문 고도화 테스트</h1>
      <p>
        상태: <strong>{status}</strong>
      </p>

      <div style={{ marginBottom: "20px" }}>
        <button onClick={connectWebSocket}>1. 서버 연결</button>
        <button
          onClick={startRecording}
          disabled={isRecording}
          style={{ background: "green", color: "white", marginLeft: "10px" }}
        >
          2. 주문 시작 (말하기)
        </button>
        <button
          onClick={stopRecording}
          disabled={!isRecording}
          style={{ background: "red", color: "white", marginLeft: "10px" }}
        >
          3. 주문 종료 (문장 끝)
        </button>
      </div>

      <div style={{ display: "flex", justifyContent: "center", gap: "20px" }}>
        <div
          style={{
            width: "45%",
            border: "2px solid #333",
            padding: "15px",
            minHeight: "200px",
          }}
        >
          <h3>👂 실시간 인식 중...</h3>
          <p style={{ fontSize: "1.4rem", color: "#007bff" }}>
            {transcript || "말씀해 주세요..."}
          </p>
        </div>

        <div
          style={{
            width: "45%",
            border: "2px solid #28a745",
            padding: "15px",
            minHeight: "200px",
            backgroundColor: "#f4fff4",
          }}
        >
          <h3>🛒 장바구니 (수량 포함)</h3>
          {cartItems.length === 0 ? (
            <p>장바구니가 비어 있습니다.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0 }}>
              {cartItems.map((item, index) => (
                <li
                  key={index}
                  style={{ borderBottom: "1px dotted #ccc", padding: "10px" }}
                >
                  <span style={{ fontSize: "1.1rem" }}>
                    <strong>{item.name}</strong> -{" "}
                    <span style={{ color: "red" }}>{item.qty}개</span>
                  </span>
                  <br />
                  <small style={{ color: "#888" }}>{item.time}</small>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
