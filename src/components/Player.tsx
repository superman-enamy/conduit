import "vidstack/styles/defaults.css";
import "vidstack/styles/community-skin/video.css";
import { defineCustomElements } from "vidstack/elements";

declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      "media-player": any;
      "media-outlet": any;
      "media-poster": any;
      "media-captions": any;
      "media-community-skin": any;
    }
  }
}

import {
  HLSErrorEvent,
  MediaCanPlayEvent,
  MediaOutletElement,
  MediaPlayerElement,
  MediaPosterElement,
  MediaProviderChangeEvent,
  isHLSProvider,
  // MediaPlayerConnectEvent,
} from "vidstack";
import {
  For,
  ParentProps,
  children,
  createEffect,
  createMemo,
  createSignal,
  lazy,
  on,
  onCleanup,
  onMount,
  useContext,
} from "solid-js";
import { PlayerContext, PreferencesContext } from "~/root";
import { PipedVideo, Subtitle } from "~/types";
import { chaptersVtt } from "~/utils/chapters";
import { useIsRouting, useLocation } from "solid-start";
// import { extractVideoId } from "~/routes/watch";
// import { RouteLocation, useLocation } from "@builder.io/qwik-city";
// import { IDBPDatabase } from "idb";
// import PlayerSkin from "./player-skin/player-skin";
import { extractVideoId } from "~/routes/watch";
import { DBContext } from "~/root";
//@ts-ignore
import { ttml2srt } from "~/utils/ttml";
import PlayerSkin from "./PlayerSkin";
import VideoCard from "./VideoCard";

const BUFFER_LIMIT = 3;
const BUFFER_TIME = 15000;
const TIME_SPAN = 300000;
export default function Player() {
  console.log(new Date().toISOString().split("T")[1], "rendering player");
  console.time("rendering player");
  const [video] = useContext(PlayerContext);
  //   const db = useContext(DBContext);
  const route = useLocation();
  let mediaPlayer: MediaPlayerElement | undefined = undefined;
  const [db] = useContext(DBContext);
  const updateProgress = () => {
    console.log("updating progress");
    if (!video.value) return;
    let currentTime = mediaPlayer?.currentTime;
    if (video.value?.duration < 60 || video.value.category === "Music") {
      currentTime = 0;
    }
    const tx = db()?.transaction("watch_history", "readwrite");
    const store = tx?.objectStore("watch_history");
    const videoId = extractVideoId(video.value.thumbnailUrl);
    console.log(videoId, video.value, "videoId");
    if (!videoId) return;
    const val = {
      ...JSON.parse(JSON.stringify(video.value)),
      progress: currentTime,
    };
    if (!store) return;

    store.put(val, videoId);
    console.log(`updated progress for ${video.value.title} to ${currentTime}`);
  };

  const [preferences, setPreferences] = useContext(PreferencesContext)

  const [vtt, setVtt] = createSignal<string | undefined>(undefined);

  const [error, setError] = createSignal<{
    name: string;
    details: string;
    fatal: boolean;
    message: string;
    code: number | undefined;
  }>();

  const [tracks, setTracks] = createSignal<
    {
      id: string;
      key: string;
      kind: string;
      src: string;
      srcLang: string;
      label: string;
      dataType: string;
    }[]
  >([]);

  const [subtitles, setSubtitles] = createSignal<Map<string, string>>();

  const fetchSubtitles = async (subtitles: Subtitle[]) => {
    console.time("fetching subtitles");
    const newTracks = await Promise.all(
      subtitles.map(async (subtitle) => {
        if (!subtitle.url) return null;
        if (subtitle.mimeType !== "application/ttml+xml")
          return {
            id: `track-${subtitle.code}`,
            key: subtitle.url,
            kind: "subtitles",
            src: subtitle.url,
            srcLang: subtitle.code,
            label: `${subtitle.name} - ${subtitle.autoGenerated ? "Auto" : ""}`,
            dataType: subtitle.mimeType,
          };
        const { srtUrl, srtText } = await ttml2srt(subtitle.url);
        // remove empty subtitles
        if (srtText.trim() === "") return null;
        return {
          id: `track-${subtitle.code}`,
          key: subtitle.url,
          kind: "subtitles",
          src: srtUrl,
          srcLang: subtitle.code,
          label: `${subtitle.name} - ${subtitle.autoGenerated ? "Auto" : ""}`,
          dataType: "srt",
        };
      })
    );
    console.timeEnd("fetching subtitles");
    setTracks(newTracks.filter((track) => track !== null) as any);
  };

  const initMediaSession = () => {
    if (!navigator.mediaSession) return;
    if (!video.value) return;
    if (!mediaPlayer) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: video.value.title,
      artist: video.value.uploader,
      artwork: [
        {
          src: video.value?.thumbnailUrl,
          sizes: "128x128",
          type: "image/png",
        },
      ],
    });
    navigator.mediaSession.setActionHandler("play", () => {
      mediaPlayer?.play();
    });
    navigator.mediaSession.setActionHandler("pause", () => {
      mediaPlayer?.pause();
    });
    navigator.mediaSession.setActionHandler("seekbackward", () => {
      mediaPlayer!.currentTime -= 10;
    });
    navigator.mediaSession.setActionHandler("seekforward", () => {
      mediaPlayer!.currentTime += 10;
    });
    navigator.mediaSession.setActionHandler("previoustrack", () => {
      console.log("previous track");
    });
    navigator.mediaSession.setActionHandler("nexttrack", () => {
      console.log("next track");
    });
    navigator.mediaSession.setActionHandler("stop", () => {
      console.log("stop");
    });
  };

  const setMediaState = () => {
    navigator.mediaSession.setPositionState({
      duration: video.value!.duration,
      playbackRate: mediaPlayer!.playbackRate,
      position: mediaPlayer!.currentTime,
    });
  };

  const init = () => {
    if (!video.value) return;
    console.time("init");
    initMediaSession();
    fetchSubtitles(video.value.subtitles);
    if (!video.value?.subtitles) return;
    const subs = new Map<string, string>();
    video.value.subtitles.forEach((subtitle) => {
      if (!subtitle.url) return;
      subs.set(subtitle.code, subtitle.url);
    });
    setSubtitles(subs);
  };

  const [currentTime, setCurrentTime] = createSignal(0);

  const onCanPlay = (event: Event) => {
    console.log("can play", route.search.match("fullscreen"));
    console.log(event);
    if (route.search.match("fullscreen")) {
      if (navigator.userActivation.isActive) {
        document.querySelector("html")?.requestFullscreen();
      }
    }
    setError(undefined);
    init();
    if (!video.value?.chapters) return;
    if (!mediaPlayer) return;
    let chapters = [];
    for (let i = 0; i < video.value.chapters.length; i++) {
      const chapter = video.value.chapters[i];
      const name = chapter.title;
      // seconds to 00:00:00
      const timestamp = new Date(chapter.start * 1000)
        .toISOString()
        .slice(11, 22);
      const seconds =
        video.value.chapters[i + 1]?.start - chapter.start ??
        video.value.duration - chapter.start;
      chapters.push({ name, timestamp, seconds });
    }

    setVtt(chaptersVtt(chapters, video.value.duration));
    if (vtt()) {
      mediaPlayer.textTracks.add({
        kind: "chapters",
        default: true,
        content: vtt(),
        type: "vtt",
      });
    }
    const { t: time } = route.query;

    if (time) {
      let start = 0;
      if (/^[\d]*$/g.test(time)) {
        start = parseInt(time);
      } else {
        const hours = /([\d]*)h/gi.exec(time)?.[1];
        const minutes = /([\d]*)m/gi.exec(time)?.[1];
        const seconds = /([\d]*)s/gi.exec(time)?.[1];
        if (hours) {
          start += parseInt(hours) * 60 * 60;
        }
        if (minutes) {
          start += parseInt(minutes) * 60;
        }
        if (seconds) {
          start += parseInt(seconds);
        }
      }
      setCurrentTime(start);
      // this.initialSeekComplete = true;
    } else if (db()) {
      //eslint-disable-next-line qwik/valid-lexical-scope
      const tx = db()!.transaction("watch_history", "readonly");
      const store = tx.objectStore("watch_history");
      const videoId = extractVideoId(video.value.thumbnailUrl);
      if (!videoId) return;
      store.get(videoId).then((v) => {
        if (!video.value) return;
        console.log(v, "val");
        const progress = v?.progress;
        if (progress) {
          if (progress < video.value.duration * 0.9) {
            setCurrentTime(progress);
          }
        }
        console.timeEnd("init");
      });
    }
  };

  const onProviderChange = (event: MediaProviderChangeEvent) => {
    console.log(event, "provider change");
    const provider = event.detail;
    if (isHLSProvider(provider)) {
      provider.library = () => import("hls.js");
    }
  };

  const handleHlsError = (err: HLSErrorEvent) => {
    console.log(err.detail);
    setError({
      name: err.detail.error.name,
      code: err.detail.response?.code,
      details: err.detail.details,
      fatal: err.detail.fatal,
      message: err.detail.error.message,
    });
  };

  //   function selectDefaultQuality() {
  //     let preferredQuality = 1080; // TODO: get from user settings
  //     if (!mediaPlayer.value) return;
  //     console.log(mediaPlayer.value.qualities);
  //     const q = mediaPlayer.value.qualities.toArray().find((q) => q.height >= preferredQuality);
  //     console.log(q);
  //     if (q) {
  //       q.selected = true;
  //     }
  //   }
  //   const pos = {
  //     tl: "top-0 -left-72",
  //   };
  //   return (
  //     <media-player
  //   title="Sprite Fight"
  //   src="https://stream.mux.com/VZtzUzGRv02OhRnZCxcNg49OilvolTqdnFLEqBsTwaxU/low.mp4"
  //   poster="https://image.mux.com/VZtzUzGRv02OhRnZCxcNg49OilvolTqdnFLEqBsTwaxU/thumbnail.webp?time=268&width=980"
  //   thumbnails="https://media-files.vidstack.io/sprite-fight/thumbnails.vtt"
  //   aspect-ratio="16/9"
  //   crossorigin
  // >
  //   <media-outlet>
  //     <media-poster
  //       alt="Girl walks into sprite gnomes around her friend on a campfire in danger!"
  //     ></media-poster>
  //    <track
  //       src="https://media-files.vidstack.io/sprite-fight/subs/english.vtt"
  //       label="English"
  //       srclang="en-US"
  //       kind="subtitles"
  //       default
  //     />
  //     <track
  //       src="https://media-files.vidstack.io/sprite-fight/chapters.vtt"
  //       srclang="en-US"
  //       kind="chapters"
  //       default
  //     />
  //   </media-outlet>
  //   <media-community-skin></media-community-skin>
  // </media-player>

  //   )
  let outlet: any;
  function toggleFloating(floating: boolean) {
    const container = document.getElementById("pip-container");
    if (!container) return;
    if (floating) {
      container.append(outlet);
      if (container.classList.contains("hidden")) {
        container.classList.remove("hidden");
      }
    } else {
      if (!container.classList.contains("hidden")) {
        container.classList.add("hidden");
      }
      mediaPlayer?.prepend(outlet);
    }
  }

  onMount(() => {
    console.log("mount", mediaPlayer);
    document.addEventListener("beforeunload", updateProgress);
    document.addEventListener("visibilitychange", updateProgress);
    mediaPlayer?.addEventListener("drag", (e: any) => {
      console.log("dragstart", e);
    });
  });
  onCleanup(() => {
    document.removeEventListener("beforeunload", updateProgress);
    document.removeEventListener("visibilitychange", updateProgress);
    mediaPlayer?.removeEventListener("drag", (e: any) => {
      console.log("dragstart", e);
    });
  });
  const isRouting = useIsRouting();
  createEffect(() => {
    if (isRouting()) {
      console.log("routing");
      updateProgress();
    }
    if (route.pathname !== "/watch") {
      toggleFloating(true);
    } else {
      toggleFloating(false);
    }
  });

  return (
    <div
      class="flex sticky md:static top-0 z-50 md:z-0"
      classList={{
        hidden: route.pathname !== "/watch",
      }}>
      <media-player
        id="player"
        class="peer w-full h-full aspect-video"
        current-time={currentTime()}
        // onTextTrackChange={handleTextTrackChange}
        load="eager"
        key-shortcuts={{
          togglePaused: "k Space",
          toggleMuted: "m",
          toggleFullscreen: "f",
          togglePictureInPicture: "i",
          toggleCaptions: "c",
          seekBackward: "ArrowLeft h",
          seekForward: "ArrowRight l",
          volumeUp: "ArrowUp",
          volumeDown: "ArrowDown",
        }}
        on:can-play={onCanPlay}
        on:provider-change={onProviderChange}
        on:hls-error={handleHlsError}
        on:pause={updateProgress}
        on:seeked={updateProgress}
        on:ended={updateProgress}
        key-target="document"
        autoplay
        ref={mediaPlayer}
        title={video.value?.title ?? ""}
        src={video.value?.hls ?? ""}
        poster={
          video.value?.thumbnailUrl.replace("maxresdefault", "mqdefault") ?? ""
        }
        aspect-ratio={16 / 9}
        crossorigin="anonymous">
        <media-outlet ref={outlet}>
          <media-poster alt={video.value?.title ?? ""} />
          {tracks().map((track) => {
            return (
              <track
                id={track.id}
                kind={track.kind as any}
                src={track.src}
                srclang={track.srcLang}
                label={track.label}
                data-type={track.dataType}
              />
            );
          })}
          <media-captions class="transition-[bottom] not-can-control:opacity-100 user-idle:opacity-100 not-user-idle:bottom-[80px]" />
        </media-outlet>
        {error()?.fatal ? (
          <div class="absolute top-0 right-0 w-full h-full opacity-100 pointer-events-auto bg-black/50">
            <div class="flex flex-col items-center justify-center w-full h-full gap-3">
              <div class="text-2xl font-bold text-white">
                {error()?.name} {error()?.details}
              </div>
              <div class="flex flex-col">
                <div class="text-lg text-white">{error()?.message}</div>
                <div class="text-lg text-white">
                  Please try switching to a different instance or refresh the
                  page.
                </div>
              </div>
              <div class="flex justify-center gap-2">
                <button
                  class="px-4 py-2 text-lg text-white border border-white rounded-md"
                  // onClick={() => window.location.reload()}
                >
                  Refresh
                </button>
                <button
                  class="px-4 py-2 text-lg text-white border border-white rounded-md"
                  onClick={() => {
                    setError(undefined);
                  }}>
                  Close
                </button>
              </div>
            </div>
          </div>
        ) : (
          <></>
          // <div class="absolute top-0 right-0 opacity-0 pointer-events-none bg-black/50">
          //   <div class="absolute top-0 right-0 z-10 flex flex-col justify-between w-full h-full text-white transition-opacity duration-200 ease-linear opacity-0 pointer-events-none can-control:opacity-100">
          //     <div class="text-sm text-white">Buffering?</div>
          //     <div class="text-xs text-white">Try switching to a different instance.</div>
          //   </div>
          // </div>
        )}
        <PlayerSkin video={video.value} isMiniPlayer={false} />
        {/* <media-community-skin></media-community-skin> */}
      </media-player>
      <div
      classList={{"lg:flex": preferences.theatreMode}}
       class="w-[28rem] hidden relative h-1 self-start justify-start">
        <div class="absolute top-0 flex w-full justify-start items-center flex-col h-full">
          <For each={video.value?.relatedStreams}>
            {(stream) => {
              return <VideoCard v={stream} />;
            }}
          </For>
        </div>
      </div>
    </div>
  );
}
