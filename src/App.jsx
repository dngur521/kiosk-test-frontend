import { useRef, useState } from "react";
import "./App.css";

const WS_URL = import.meta.env.VITE_WS_URL;

function App() {
  const [status, setStatus] = useState("Disconnected");
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [cartItems, setCartItems] = useState([]);
  const [isSpeakingUI, setIsSpeakingUI] = useState(false);

  const socketRef = useRef(null);
  const audioContextRef = useRef(null);
  const streamRef = useRef(null);
  const isSpeakingRef = useRef(false);

  // 음성 안내 함수 (Web Speech API)
  const speak = (text) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "ko-KR";
    utterance.rate = 0.9;

    utterance.onstart = () => {
      isSpeakingRef.current = true;
      setIsSpeakingUI(true);
    };

    utterance.onend = () => {
      setTimeout(() => {
        if (!window.speechSynthesis.speaking) {
          isSpeakingRef.current = false;
          setIsSpeakingUI(false);
        }
      }, 1500); // 안내 후 1.5초간 마이크 차단
    };

    window.speechSynthesis.speak(utterance);
  };

  const connectWebSocket = () => {
    socketRef.current = new WebSocket(WS_URL);
    socketRef.current.onopen = () => setStatus("✅ 서버와 연결되었습니다!");

    socketRef.current.onmessage = (event) => {
      const message = event.data;
      console.log("📩 서버 메시지 수신:", message);

      if (!message.startsWith("SYSTEM:") && isSpeakingRef.current) return;

      // 1. 주문 성공
      if (message.startsWith("SYSTEM:ORDER_SUCCESS:")) {
        const [, , menuName, quantity] = message.split(":");
        setTranscript(`✅ 주문: ${menuName} ${quantity}개`);

        setCartItems((prev) => {
          const existing = prev.find((item) => item.name === menuName);
          if (existing) {
            return prev.map((item) =>
              item.name === menuName
                ? { ...item, qty: parseInt(item.qty) + parseInt(quantity) }
                : item,
            );
          }
          return [
            ...prev,
            {
              name: menuName,
              qty: quantity,
              time: new Date().toLocaleTimeString(),
            },
          ];
        });
        speak(`${menuName} ${quantity}개가 장바구니에 담겼습니다.`);
      }

      // 2. 개별 취소 성공 (SYSTEM:CANCEL_SUCCESS:메뉴명:수량)
      // App.jsx의 onmessage 내 개별 취소 로직 수정
      else if (message.startsWith("SYSTEM:CANCEL_SUCCESS:")) {
        const parts = message.split(":");
        const menuName = parts[2];
        const quantityStr = parts[3]; // "1", "2" 또는 "ALL"

        setTranscript(
          `🗑️ 취소: ${menuName} ${quantityStr === "ALL" ? "전체" : quantityStr + "개"}`,
        );

        setCartItems((prev) => {
          // 1. "ALL"인 경우: 해당 메뉴를 리스트에서 아예 제거
          if (quantityStr === "ALL") {
            return prev.filter((item) => item.name !== menuName);
          }

          // 2. 숫자인 경우: 해당 수량만큼 차감
          const cancelQty = parseInt(quantityStr) || 1;
          return prev
            .map((item) =>
              item.name === menuName
                ? { ...item, qty: item.qty - cancelQty }
                : item,
            )
            .filter((item) => item.qty > 0); // 0개 이하가 되면 제거
        });

        const speakMsg =
          quantityStr === "ALL"
            ? `${menuName} 전체 취소가 완료되었습니다.`
            : `${menuName} ${quantityStr}개 취소되었습니다.`;
        speak(speakMsg);
      }

      // 3. 🔥 [핵심 추가] 전체 삭제 성공 (SYSTEM:CLEAR_CART_SUCCESS)
      else if (message === "SYSTEM:CLEAR_CART_SUCCESS") {
        setTranscript("🗑️ 모든 메뉴를 삭제했습니다.");
        setCartItems([]); // 장바구니 초기화
        speak("장바구니의 모든 메뉴를 비웠습니다.");
      }

      // 4. 수량 재질의 (모호한 표현 시)
      else if (message.startsWith("SYSTEM:REASK_QUANTITY:")) {
        const menuName = message.split(":")[2];
        const userQty = window.prompt(
          `🛒 ${menuName} 몇 개를 드릴까요? (1~10):`,
          "1",
        );
        if (userQty) {
          setCartItems((prev) => [
            ...prev,
            {
              name: menuName,
              qty: userQty,
              time: new Date().toLocaleTimeString(),
            },
          ]);
          speak(`${menuName} ${userQty}개 확인했습니다.`);
        }
      }

      // 5. 일반 인식 텍스트
      else {
        if (!isSpeakingRef.current) setTranscript(message);
      }
    };

    socketRef.current.onerror = () => setStatus("❌ 에러 발생");
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
      <h1>🎙️ 지능형 음성 주문 시스템</h1>
      <p>
        상태: <strong>{status}</strong>{" "}
        {isSpeakingUI && (
          <span style={{ color: "red", fontWeight: "bold" }}>
            (안내 중 - 마이크 잠금)
          </span>
        )}
      </p>

      <div style={{ marginBottom: "20px" }}>
        <button onClick={connectWebSocket}>1. 서버 연결</button>
        <button
          onClick={startRecording}
          disabled={isRecording}
          style={{ background: "green", color: "white", marginLeft: "10px" }}
        >
          2. 주문 시작
        </button>
        <button
          onClick={stopRecording}
          disabled={!isRecording}
          style={{ background: "red", color: "white", marginLeft: "10px" }}
        >
          3. 주문 종료
        </button>
      </div>

      <div style={{ display: "flex", justifyContent: "center", gap: "20px" }}>
        <div
          style={{
            width: "45%",
            border: "2px solid #007bff",
            padding: "15px",
            borderRadius: "10px",
            minHeight: "250px",
          }}
        >
          <h3>👂 인식된 내용</h3>
          <p
            style={{ fontSize: "1.4rem", color: "#007bff", fontWeight: "500" }}
          >
            {transcript || "말씀해 주세요..."}
          </p>
        </div>

        <div
          style={{
            width: "45%",
            border: "2px solid #28a745",
            padding: "15px",
            borderRadius: "10px",
            minHeight: "250px",
            backgroundColor: "#f8fff8",
          }}
        >
          <h3>🛒 장바구니</h3>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {cartItems.length === 0 ? (
              <p style={{ color: "#888" }}>비어 있습니다.</p>
            ) : (
              cartItems.map((item, i) => (
                <li
                  key={i}
                  style={{
                    borderBottom: "1px solid #eee",
                    padding: "8px 0",
                    fontSize: "1.1rem",
                  }}
                >
                  <strong>{item.name}</strong> -{" "}
                  <span style={{ color: "red" }}>{item.qty}개</span>
                  <div style={{ fontSize: "0.8rem", color: "#999" }}>
                    {item.time}
                  </div>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

export default App;
