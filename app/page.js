"use client";
// react states
import { useEffect, useRef, useCallback, useState } from "react";

// openai realtime api
import { RealtimeClient } from "@openai/realtime-api-beta";

// wav formats
import { WavRecorder, WavStreamPlayer } from "../lib/wavtools/index";
import { WavRenderer } from "@/utils/wav_renderer";

// shadcn
import { Button } from "@/components/ui/button";
import { instructions } from "@/utils/conversation_config";

export default function Home() {
  const [isConnected, setIsConnected] = useState(false);

  // wav ref
  const wavRecorderRef = useRef(new WavRecorder({ sampleRate: 24000 }));
  const wavStreamPlayerRef = useRef(new WavStreamPlayer({ sampleRate: 24000 }));

  // open ai client
  const clientRef = useRef(
    new RealtimeClient({
      apiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY,
      dangerouslyAllowAPIKeyInBrowser: true,
    })
  );

  // canvas ref
  const clientCanvasRef = useRef(null);
  const serverCanvasRef = useRef(null);

  /**
   * Connect to conversation:
   * WavRecorder taks speech input, WavStreamPlayer output, client is API client
   */
  const connectConversation = useCallback(async () => {
    // get refrence to the wav
    const wavRecorder = wavRecorderRef.current;
    const wavStreamPlayer = wavStreamPlayerRef.current;

    // get open ai client refrence
    const client = clientRef.current;

    //make connection state true
    setIsConnected(true);

    // Connect to microphone
    await wavRecorder.begin();

    // Connect to audio output
    await wavStreamPlayer.connect();

    // Connect to realtime API
    await client.connect();

    client.sendUserMessageContent([
      {
        type: `input_text`,
        text: `Hello!`,
      },
    ]);

    if (client.getTurnDetectionType() === "server_vad") {
      await wavRecorder.record((data) => client.appendInputAudio(data.mono));
    }
  }, []);

  /**
   * Disconnect and reset conversation state
   */
  const disconnectConversation = useCallback(async () => {
    // make connection state false
    setIsConnected(false);

    // get refrence to the wav
    const wavRecorder = wavRecorderRef.current;
    const wavStreamPlayer = wavStreamPlayerRef.current;

    // open ai client refrence
    const client = clientRef.current;

    client.disconnect();

    await wavRecorder.end();

    wavStreamPlayer.interrupt();
  }, []);

  const toggleConnection = useCallback(() => {
    if (!process.env.NEXT_PUBLIC_OPENAI_API_KEY) {
      alert("no api key found");
      return;
    }

    if (isConnected) {
      disconnectConversation();
    } else {
      connectConversation();
    }
  });

  /**
   * Set up render loops for the visualization canvas
   */
  useEffect(() => {
    let isLoaded = true;

    const wavRecorder = wavRecorderRef.current;
    const clientCanvas = clientCanvasRef.current;
    let clientCtx = null;

    const wavStreamPlayer = wavStreamPlayerRef.current;
    const serverCanvas = serverCanvasRef.current;
    let serverCtx = null;

    const render = () => {
      if (isLoaded) {
        if (clientCanvas) {
          if (!clientCanvas.width || !clientCanvas.height) {
            clientCanvas.width = clientCanvas.offsetWidth;
            clientCanvas.height = clientCanvas.offsetHeight;
          }
          clientCtx = clientCtx || clientCanvas.getContext("2d");
          if (clientCtx) {
            clientCtx.clearRect(0, 0, clientCanvas.width, clientCanvas.height);
            const result = wavRecorder.recording
              ? wavRecorder.getFrequencies("voice")
              : { values: new Float32Array([0]) };
            WavRenderer.drawBars(
              clientCanvas,
              clientCtx,
              result.values,
              "#0099ff",
              30,
              10,
              4
            );
          }
        }
        if (serverCanvas) {
          if (!serverCanvas.width || !serverCanvas.height) {
            serverCanvas.width = serverCanvas.offsetWidth;
            serverCanvas.height = serverCanvas.offsetHeight;
          }
          serverCtx = serverCtx || serverCanvas.getContext("2d");
          if (serverCtx) {
            serverCtx.clearRect(0, 0, serverCanvas.width, serverCanvas.height);
            const result = wavStreamPlayer.analyser
              ? wavStreamPlayer.getFrequencies("voice")
              : { values: new Float32Array([0]) };
            WavRenderer.drawBars(
              serverCanvas,
              serverCtx,
              result.values,
              "#009900",
              30,
              10,
              4
            );
          }
        }
        window.requestAnimationFrame(render);
      }
    };
    render();

    return () => {
      isLoaded = false;
    };
  }, []);

  /**
   * Core RealtimeClient and audio capture setup
   * Set all of our instructions, tools, events and more
   */
  useEffect(() => {
    // Get refs
    const wavStreamPlayer = wavStreamPlayerRef.current;
    const client = clientRef.current;

    // Set instructions
    client.updateSession({ instructions: instructions });

    // Set transcription, otherwise we don't get user transcriptions back
    client.updateSession({ input_audio_transcription: { model: "whisper-1" } });

    // using VAD
    client.updateSession({
      turn_detection: { type: "server_vad" },
    });

    // Add tools
    client.addTool(
      {
        name: "book_appointment",
        description: "books appointment for users",
        parameters: {
          type: "object",
          properties: {
            time: {
              type: "string",
              description: "the time of the appointment",
            },
            name: {
              type: "string",
              description: "the name of the person",
            },
          },
          required: ["time", "name"],
        },
      },
      async ({ time, name }) => {
        console.log(time, name, "<==============here==============");
        return `appointment set for ${time} with ${name}`;
      }
    );

    client.addTool(
      {
        name: "start_introduction",
        description: "start the introduction of the video",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      async () => {
        return `tell the user: hello guys welcome to the coding monk youtube channel in this video we will talk about open ai's new real time api`;
      }
    );

    client.on("error", (event) => console.error(event));

    client.on("conversation.interrupted", async () => {
      const trackSampleOffset = wavStreamPlayer.interrupt();
      if (trackSampleOffset?.trackId) {
        const { trackId, offset } = trackSampleOffset;
        client.cancelResponse(trackId, offset);
      }
    });

    client.on("conversation.updated", async ({ item, delta }) => {
      if (delta?.audio) {
        wavStreamPlayer.add16BitPCM(delta.audio, item.id);
      }
      if (item.status === "completed" && item.formatted.audio?.length) {
        const wavFile = await WavRecorder.decode(
          item.formatted.audio,
          24000,
          24000
        );
        item.formatted.file = wavFile;
      }
    });

    return () => {
      client.reset();
    };
  }, []);

  return (
    <div className="h-screen w-screen flex items-end p-4 gap-4">
      <div className="absolute top-4 flex items-center gap-2">
        <Button
          onClick={toggleConnection}
          className="bg-black text-white"
          variant="outline"
        >
          {isConnected ? "Disconnect" : "Connect"}
        </Button>
        <div
          className={`w-4 h-4 rounded-full ${
            isConnected ? "bg-green-500" : "bg-red-500"
          }`}
        />
      </div>
      <div className="w-1/2 h-3/4 shadow-[0_3px_10px_rgb(0,0,0,0.2)] rounded-md flex flex-col justify-between">
        <p className="font-bold text-center py-2 border-b">USER</p>
        <canvas className="w-full" ref={clientCanvasRef} />
      </div>
      <div className="w-1/2 h-3/4 shadow-[0_3px_10px_rgb(0,0,0,0.2)] rounded-md flex flex-col justify-between">
        <p className="font-bold text-center py-2 border-b">BOT</p>
        <canvas className="w-full" ref={serverCanvasRef} />
      </div>
    </div>
  );
}
