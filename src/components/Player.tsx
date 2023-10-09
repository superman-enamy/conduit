// Import styles.
import "vidstack/player/styles/base.css";
// Register elements.
import "vidstack/player";
import "vidstack/player/ui";
import "vidstack/solid";
import "vidstack/icons";

import {
  HLSErrorEvent,
  MediaProviderChangeEvent,
  isHLSProvider,
} from "vidstack";
import {
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  useContext,
} from "solid-js";
import { PlayerContext } from "~/root";
import {
  Chapter,
  PipedVideo,
  PreviewFrame,
  RelatedStream,
  Subtitle,
} from "~/types";
import { chaptersVtt } from "~/lib/chapters";
import { useIsRouting, useLocation, useNavigate } from "solid-start";
import { ttml2srt } from "~/lib/ttml";
import PlayerSkin from "./PlayerSkin";
import VideoCard from "./VideoCard";
import { videoId } from "~/routes/library/history";
import { useQueue } from "~/stores/queueStore";
import { usePlaylist } from "~/stores/playlistStore";
import { HistoryItem, useSyncStore } from "~/stores/syncStore";
import { usePlayerState } from "../stores/playerStateStore";
import { MediaRemoteControl } from "vidstack";
import { toaster } from "@kobalte/core";
import ToastComponent from "./Toast";
import { Suspense } from "solid-js";
import { isServer } from "solid-js/web";
import { MediaPlayerElement } from "vidstack/elements";
import { VideoLayout } from "./player/layouts/VideoLayout";
import { usePreferences } from "~/stores/preferencesStore";

export default function Player(props: {
  video: PipedVideo;
  onReload?: () => void;
}) {
  const route = useLocation();
  let mediaPlayer!: MediaPlayerElement;
  const sync = useSyncStore();
  const updateProgress = async () => {
    if (!props.video) return;
    if (!started()) {
      return;
    }
    let currentTime = mediaPlayer?.currentTime;
    if (props.video.category === "Music") {
      currentTime = 0;
    }
    const id = videoId(props.video);
    if (!id) return;
    console.time("updating progress");

    const val = {
      title: props.video.title,
      duration: props.video.duration,
      thumbnail: props.video.thumbnailUrl,
      uploaderName: props.video.uploader,
      uploaderAvatar: props.video.uploaderAvatar,
      uploaderUrl: props.video.uploaderUrl,
      url: `/watch?v=${id}`,
      currentTime: currentTime ?? props.video.duration,
      watchedAt: new Date().getTime(),
      type: "stream",
      uploaded: new Date(props.video.uploadDate).getTime(),
      uploaderVerified: props.video.uploaderVerified,
      views: props.video.views,
    };
    console.log("updating progress", val);

    setTimeout(() => {
      if (sync.store.history[id]) {
        sync.setStore("history", id, "currentTime", currentTime);
        sync.setStore("history", id, "watchedAt", new Date().getTime());
      } else {
        sync.setStore("history", id, val);
      }
      console.timeEnd("updating progress");
    }, 0);
  };
  const state = usePlayerState();

  const [playlist] = usePlaylist();

  const queueStore = useQueue();

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
      metadata: {
        url: string;
      };
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
        // const { srtUrl, srtText } = await ttml2srt(subtitle.url);
        // remove empty subtitles
        // if (srtText.trim() === "") return null;
        return {
          id: `track-${subtitle.code}`,
          key: subtitle.url,
          kind: "subtitles",
          src: "",
          srcLang: subtitle.code,
          label: `${subtitle.name} - ${subtitle.autoGenerated ? "Auto" : ""}`,
          dataType: "srt",
          metadata: {
            url: subtitle.url,
          },
        };
      })
    );
    console.timeEnd("fetching subtitles");
    setTracks(newTracks.filter((track) => track !== null) as any);
  };

  const initMediaSession = () => {
    if (!navigator.mediaSession) return;
    if (!props.video) return;
    if (!mediaPlayer) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: props.video.title,
      artist: props.video.uploader,
      artwork: [
        {
          src: props.video?.thumbnailUrl,
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
      mediaPlayer!.currentTime -= 10;
    });
    navigator.mediaSession.setActionHandler("nexttrack", () => {
      mediaPlayer!.currentTime += 10;
    });
    navigator.mediaSession.setActionHandler("stop", () => {
      console.log("stop");
    });
  };

  function yieldToMain() {
    return new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
  const init = async () => {
    if (!props.video) throw new Error("No video");
    console.time("init");
    initMediaSession();
    await yieldToMain();
    fetchSubtitles(props.video.subtitles);
    if (!props.video?.subtitles) return;
    const subs = new Map<string, string>();
    props.video.subtitles.forEach((subtitle) => {
      if (!subtitle.url) return;
      subs.set(subtitle.code, subtitle.url);
    });
    setSubtitles(subs);
  };

  const [currentTime, setCurrentTime] = createSignal(0);
  const time = route.query.t;
  const [started, setStarted] = createSignal(false);

  const onCanPlay = (event: Event) => {
    console.log("can play", route.search.match("fullscreen"));
    console.log(event);
    setError(undefined);
    init();
    if (!props.video?.chapters) return;
    if (!mediaPlayer) return;
    if (route.search.match("fullscreen")) {
      //@ts-ignore
      if (navigator.userActivation.isActive) {
        mediaPlayer?.requestFullscreen();
      }
    }
    let chapters = [];
    for (let i = 0; i < props.video.chapters.length; i++) {
      const chapter = props.video.chapters[i];
      const name = chapter.title;
      // seconds to 00:00:00
      const timestamp = new Date(chapter.start * 1000)
        .toISOString()
        .slice(11, 22);
      const seconds =
        props.video.chapters[i + 1]?.start - chapter.start ??
        props.video.duration - chapter.start;
      chapters.push({ name, timestamp, seconds });
    }

    console.time("chapters vtt");
    setVtt(chaptersVtt(chapters, props.video.duration));
    if (vtt()) {
      mediaPlayer.textTracks.add({
        kind: "chapters",
        default: true,
        content: vtt(),
        type: "vtt",
      });
    }
    console.timeEnd("chapters vtt");

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
    }
  };

  createEffect(() => {
    if (!props.video) return;
    if (!mediaPlayer) return;
    if (time) return;
    const id = videoId(props.video);
    if (!id) return;
    console.time("getting progress");
    const val = sync.store.history[id];
    const progress = val?.currentTime;
    if (progress) {
      if (progress < props.video.duration * 0.9) {
        setCurrentTime(progress);
      }
    }
    console.timeEnd("getting progress");
  });

  createEffect(() => {
    const nextVideo = props.video?.relatedStreams?.[0];
    if (!nextVideo) return;
    if (!mediaPlayer) return;
    if (!props.video) return;
    if (route.query.list) return;
    queueStore.setCurrentVideo({
      url: `/watch?v=${videoId(props.video)}`,
      title: props.video.title,
      thumbnail: props.video.thumbnailUrl,
      duration: props.video.duration,
      uploaderName: props.video.uploader,
      uploaderAvatar: props.video.uploaderAvatar,
      uploaderUrl: props.video.uploaderUrl,
      isShort: false,
      shortDescription: "",
      type: "video",
      uploaded: new Date(props.video.uploadDate).getTime(),
      views: props.video.views,
      uploadedDate: props.video.uploadDate,
      uploaderVerified: props.video.uploaderVerified,
    });
    if (queueStore.isCurrentLast()) {
      queueStore.addToQueue(nextVideo);
    }
  });

  const playNext = () => {
    console.log("playing next", nextVideo());
    if (!nextVideo()) return;

    navigate(nextVideo()!.url, { replace: false });
    setEnded(false);
  };

  function handleSetNextVideo() {
    console.log("setting next video");
    let url = `/watch?v=`;
    if (playlist()) {
      const local = "videos" in playlist()!;
      const listId =
        route.query.list ?? (playlist() as unknown as { id: string })!.id;
      let index; // index starts from 1
      if (route.query.index) {
        index = parseInt(route.query.index);
      } else if (local) {
        index = (playlist() as unknown as {
          videos: RelatedStream[];
        })!.videos!.findIndex((v) => videoId(v) === videoId(props.video));
        if (index !== -1) index++;
      } else {
        index = playlist()!.relatedStreams!.findIndex(
          (v) => videoId(v) === videoId(props.video)
        );
        if (index !== -1) index++;
      }

      if (index < playlist()!.relatedStreams?.length) {
        const next = playlist()!.relatedStreams[index]; // index is already +1
        url += `${videoId(next)}&list=${listId}&index=${index + 1}`;
        setNextVideo({ url: url, info: next });
      } else if (
        index <
        (playlist() as unknown as { videos: RelatedStream[] })!.videos?.length
      ) {
        const next = (playlist() as unknown as {
          videos: RelatedStream[];
        })!.videos[index]; // index is already +1
        url += `${videoId(next)}&list=${listId}&index=${index + 1}`;
        setNextVideo({
          url: url,
          info: next,
        });
      }
      return;
    }
    const next = queueStore.next();
    if (!next) return;

    setNextVideo({
      url: `/watch?v=${videoId(next)}`,
      info: next,
    });
  }

  createEffect(() => {
    if (!props.video) return;
    if (!mediaPlayer) return;
    handleSetNextVideo();
  });

  const [ended, setEnded] = createSignal(false);
  const [nextVideo, setNextVideo] = createSignal<{
    url: string;
    info: RelatedStream;
  } | null>(null);

  const handleEnded = () => {
    console.log("ended");
    if (!mediaPlayer) return;
    if (!props.video) return;
    setEnded(true);
    showToast();
    updateProgress();
  };

  const [showEndScreen, setShowEndScreen] = createSignal(false);
  const defaultCounter = 5;
  const [counter, setCounter] = createSignal(defaultCounter);
  let timeoutCounter: any;

  createEffect(() => {
    console.log("ended effect", ended());
    console.log(navigator.storage.estimate());
    if (!ended()) return;
    if (!mediaPlayer) return;
    if (!props.video) return;
  });

  function showToast() {
    console.log("showing toast");
    setCounter(defaultCounter);
    if (counter() < 1) {
      console.log("counter less than 1");
      playNext();
      return;
    }
    if (timeoutCounter) clearInterval(timeoutCounter);
    timeoutCounter = setInterval(() => {
      console.log("counting", counter());
      setCounter((c) => c - 1);
      if (counter() === 0) {
        dismiss();
        playNext();
      }
    }, 1000);
    console.log("showing end screen");
    setShowEndScreen(true);
  }

  function dismiss() {
    console.log("dismiss");
    clearInterval(timeoutCounter);
    setShowEndScreen(false);
  }

  onCleanup(() => {
    if (isServer) return;
    clearInterval(timeoutCounter);
    document.removeEventListener("keydown", handleKeyDown);
  });

  const onProviderChange = async (event: MediaProviderChangeEvent) => {
    console.log(event, "provider change");
    const provider = event.detail;
    if (isHLSProvider(provider)) {
      provider.library = async () => await import("hls.js");
      console.log(provider);
      provider.config = {
        startLevel: 13,
      };
    }
  };

  const [errors, setErrors] = createSignal<
    {
      name: string;
      details: string;
      fatal: boolean;
      message: string;
      code: number | undefined;
    }[]
  >([]);
  const [showErrorScreen, setShowErrorScreen] = createSignal({
    show: false,
    dismissed: false,
  });
  const handleHlsError = (err: HLSErrorEvent) => {
    if (err.detail.fatal) {
      setShowErrorScreen((prev) => ({ ...prev, show: true }));
      if (errors().length < 10) {
        setErrors((prev) => [
          ...prev,
          {
            name: err.detail.error.name,
            code: err.detail.response?.code,
            details: err.detail.details,
            fatal: err.detail.fatal,
            message: err.detail.error.message,
          },
        ]);
      } else {
        setErrors((prev) => [
          ...prev.slice(1),
          {
            name: err.detail.error.name,
            code: err.detail.response?.code,
            details: err.detail.details,
            fatal: err.detail.fatal,
            message: err.detail.error.message,
          },
        ]);
      }
    }

    console.log(errors());
    //   mediaPlayer?.destroy();
  };

  function selectDefaultQuality() {
    let preferredQuality = 1080; // TODO: get from user settings
    if (!mediaPlayer) return;
    console.log(mediaPlayer.qualities);
    const q = mediaPlayer.qualities
      ?.toArray()
      .find((q) => q.height >= preferredQuality);
    console.log(q);
    if (q) {
      q.selected = true;
    }
  }
  createEffect(() => {
    if (!mediaPlayer) return;
    if (!props.video) return;
    selectDefaultQuality();
  });

  onMount(() => {
    if (isServer) return;
    console.log("mount", mediaPlayer);
    document.addEventListener("visibilitychange", updateProgress);
    document.addEventListener("pagehide", updateProgress);
  });

  onCleanup(() => {
    if (isServer) return;
    document.removeEventListener("visibilitychange", updateProgress);
    document.removeEventListener("pagehide", updateProgress);
  });

  createEffect(() => {
    if (!started()) return;
    updateProgress();
  });

  const isRouting = useIsRouting();
  const navigate = useNavigate();
  createEffect(() => {
    if (isRouting()) {
      console.log("routing");
      // if ("window" in globalThis) {
      //   // add fullscreen parameter
      //   const url = new URL(window.location.href);
      //   url.searchParams.set("fullscreen", "true");
      //   navigate(url.href.replace(url.origin, "").toString(), { replace: false});
      // }
      updateProgress();
    }
  });

  const generateStoryboard = (
    previewFrames: PreviewFrame | undefined
  ): string | null => {
    if (!previewFrames) return null;
    let output = "WEBVTT\n\n";
    let currentTime = 0;

    for (let url of previewFrames.urls) {
      for (let y = 0; y < previewFrames.framesPerPageY; y++) {
        for (let x = 0; x < previewFrames.framesPerPageX; x++) {
          if (
            currentTime >=
            previewFrames.totalCount * previewFrames.durationPerFrame
          ) {
            break;
          }

          let startX = x * previewFrames.frameWidth;
          let startY = y * previewFrames.frameHeight;

          output += `${formatTime(currentTime)} --> ${formatTime(
            currentTime + previewFrames.durationPerFrame
          )}\n`;
          output += `${url}#xywh=${startX},${startY},${previewFrames.frameWidth},${previewFrames.frameHeight}\n\n`;

          currentTime += previewFrames.durationPerFrame;
        }
      }
    }

    function formatTime(ms: number): string {
      let hours = Math.floor(ms / 3600000);
      ms -= hours * 3600000;
      let minutes = Math.floor(ms / 60000);
      ms -= minutes * 60000;
      let seconds = Math.floor(ms / 1000);
      ms -= seconds * 1000;

      return `${hours.toString().padStart(2, "0")}:${minutes
        .toString()
        .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}.${ms
        .toString()
        .padStart(3, "0")}`;
    }

    const blob = new Blob([output], { type: "text/vtt" });
    return URL.createObjectURL(blob);
  };
  const [mediaPlayerConnected, setMediaPlayerConnected] = createSignal(false);
  const [remote, setRemote] = createSignal<MediaRemoteControl | undefined>(
    undefined
  );

  createEffect(() => {
    if (!mediaPlayerConnected()) return;
    if (!props.video) return;
    document.addEventListener("keydown", handleKeyDown);
  });
  createEffect(() => {
    if (!mediaPlayer) return;
    setRemote(new MediaRemoteControl());
  });

  onCleanup(() => {
    if (isServer) return;
    document.removeEventListener("keydown", handleKeyDown);
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    // if an input is focused
    if (document.activeElement?.tagName === "INPUT") return;
    switch (e.key) {
      case "f":
        if (document.fullscreenElement) {
          mediaPlayer?.exitFullscreen();
        } else {
          mediaPlayer?.requestFullscreen();
        }
        e.preventDefault();
        break;
      case "m":
        mediaPlayer!.muted = !mediaPlayer!.muted;
        e.preventDefault();
        break;
      case "j":
        mediaPlayer!.currentTime = Math.max(mediaPlayer!.currentTime - 10, 0);
        e.preventDefault();
        break;
      case "l":
        mediaPlayer!.currentTime = Math.min(
          mediaPlayer!.currentTime + 10,
          props.video!.duration
        );
        e.preventDefault();
        break;
      case "c":
        const captions = mediaPlayer!.textTracks
          .toArray()
          .find(
            (t: any) =>
              t.language === "en" ||
              t.language === "en_US" ||
              t.language === "en_GB"
          );
        if (captions) {
          console.log(captions);
          const trackUrl = tracks().find((t) => t.id === captions.id)?.metadata
            .url;

          if (trackUrl)
            ttml2srt(trackUrl, null).then(({ srtUrl }: { srtUrl: string }) => {
              (captions as any).src = srtUrl;

              captions.mode =
                captions.mode === "showing" ? "hidden" : "showing";
            });
        }
        e.preventDefault();
        break;
      case "k":
        if (mediaPlayer!.paused) {
          mediaPlayer!.play();
          setTimeout(() => {
            mediaPlayer.controls.hide(0);
          }, 100);
        } else mediaPlayer!.pause();
        e.preventDefault();
        break;
      case " ":
        if (document.activeElement?.tagName === "BUTTON") return;
        if (document.activeElement?.tagName.startsWith("MEDIA-")) return;
        if (mediaPlayer!.paused) mediaPlayer!.play();
        else mediaPlayer!.pause();
        e.preventDefault();
        break;
      case "ArrowUp":
        mediaPlayer!.volume = Math.min(mediaPlayer!.volume + 0.05, 1);
        e.preventDefault();
        break;
      case "ArrowDown":
        mediaPlayer!.volume = Math.max(mediaPlayer!.volume - 0.05, 0);
        e.preventDefault();
        break;
      case "ArrowLeft":
        if (e.shiftKey) {
          prevChapter();
        } else {
          mediaPlayer!.currentTime = Math.max(mediaPlayer!.currentTime - 5, 0);
        }
        e.preventDefault();
        break;
      case "ArrowRight":
        if (e.shiftKey) {
          nextChapter();
        } else {
          mediaPlayer!.currentTime = mediaPlayer!.currentTime + 5;
        }
        e.preventDefault();
        break;
      case "0":
        mediaPlayer!.currentTime = 0;
        e.preventDefault();
        break;
      case "1":
        mediaPlayer!.currentTime = props.video!.duration * 0.1;
        e.preventDefault();
        break;
      case "2":
        mediaPlayer!.currentTime = props.video!.duration * 0.2;
        e.preventDefault();
        break;
      case "3":
        mediaPlayer!.currentTime = props.video!.duration * 0.3;
        e.preventDefault();
        break;
      case "4":
        mediaPlayer!.currentTime = props.video!.duration * 0.4;
        e.preventDefault();
        break;
      case "5":
        mediaPlayer!.currentTime = props.video!.duration * 0.5;
        e.preventDefault();
        break;
      case "6":
        mediaPlayer!.currentTime = props.video!.duration * 0.6;
        e.preventDefault();
        break;
      case "7":
        mediaPlayer!.currentTime = props.video!.duration * 0.7;
        e.preventDefault();
        break;
      case "8":
        mediaPlayer!.currentTime = props.video!.duration * 0.8;
        e.preventDefault();
        break;
      case "9":
        mediaPlayer!.currentTime = props.video!.duration * 0.9;
        e.preventDefault();
        break;
      case "N":
        if (e.shiftKey) {
          playNext();
          e.preventDefault();
        }
        break;
      case "Escape":
        if (showEndScreen() && nextVideo()) {
          dismiss();
          e.preventDefault();
        } else if (showErrorScreen().show) {
          setShowErrorScreen({ show: false, dismissed: true });
          e.preventDefault();
          // mediaPlayer?.exitFullscreen();
        }
        break;

      case ",":
        mediaPlayer!.currentTime -= 0.04;
        break;
      case ".":
        mediaPlayer!.currentTime += 0.04;
        break;
      case "R":
        if (e.shiftKey) {
          updateProgress();
          props.onReload?.();
          e.preventDefault();
        }
        break;

      // case "return":
      //   self.skipSegment(mediaPlayer!);
      //   break;
    }
  };
  interface Segment extends Chapter {
    end: number;
    manuallyNavigated: boolean;
    autoSkipped: boolean;
  }
  const [sponsorSegments, setSponsorSegments] = createSignal<Segment[]>([]);
  createEffect(() => {
    if (!props.video?.chapters) return;
    const segments: Segment[] = [];

    for (let i = 0; i < props.video.chapters.length; i++) {
      const chapter = props.video.chapters[i];
      if (chapter.title.startsWith("Sponsor")) {
        segments.push({
          ...chapter,
          end: props.video.chapters[i + 1]?.start || props.video.duration,
          manuallyNavigated: false,
          autoSkipped: false,
        });
      }
    }
    setSponsorSegments(segments);
  });

  const autoSkipHandler = () => {
    if (!mediaPlayer) return;
    if (sponsorSegments().length === 0) return;
    const currentTime = mediaPlayer.currentTime;
    let segments = sponsorSegments();
    for (const segment of segments) {
      if (
        currentTime >= segment.start &&
        currentTime < segment.end &&
        !segment.manuallyNavigated &&
        !segment.autoSkipped
      ) {
        mediaPlayer.currentTime = segment.end;
        segment.autoSkipped = true; // Mark as automatically skipped
        break;
      }
    }
    setSponsorSegments(segments);
  };

  const userNavigationHandler = () => {
    if (!mediaPlayer) return;
    if (sponsorSegments().length === 0) return;

    const currentTime = mediaPlayer.currentTime;
    let segments = sponsorSegments();
    for (const segment of segments) {
      if (currentTime >= segment.start && currentTime < segment.end) {
        segment.manuallyNavigated = true;
        segment.autoSkipped = false; // Reset the auto-skipped flag
        break;
      } else {
        // Reset flags for segments that are not being navigated to
        segment.manuallyNavigated = false;
        segment.autoSkipped = false;
      }
    }
    setSponsorSegments(segments);
  };

  const prevChapter = () => {
    if (!mediaPlayer) return;
    if (!props.video?.chapters) return;
    const currentTime = mediaPlayer.currentTime;
    let currentChapter: Chapter | undefined;
    for (let i = 0; i < props.video.chapters.length; i++) {
      const chapter = props.video.chapters[i];
      if (
        currentTime >= chapter.start &&
        currentTime < props.video.chapters[i + 1]?.start
      ) {
        currentChapter = chapter;
        break;
      }
    }
    if (!currentChapter) return;
    const prevChapter = props.video.chapters.find(
      (c) => c.start < currentChapter!.start
    );
    if (!prevChapter) return;
    mediaPlayer.currentTime = prevChapter.start;
  };

  const nextChapter = () => {
    if (!mediaPlayer) return;
    if (!props.video?.chapters) return;
    const currentTime = mediaPlayer.currentTime;
    let currentChapter: Chapter | undefined;
    for (let i = 0; i < props.video.chapters.length; i++) {
      const chapter = props.video.chapters[i];
      if (
        currentTime >= chapter.start &&
        currentTime < props.video.chapters[i + 1]?.start
      ) {
        currentChapter = chapter;
        break;
      }
    }
    if (!currentChapter) return;
    const nextChapter = props.video.chapters.find(
      (c) => c.start > currentChapter!.start
    );
    if (!nextChapter) return;
    mediaPlayer.currentTime = nextChapter.start;
  };
  const [preferences, setPreferences] = usePreferences();
  let mediaProvider: any;

  return (
    <media-player
      id="player"
      class="w-full aspect-video bg-slate-900 text-white font-sans overflow-hidden rounded-md ring-primary data-[focus]:ring-4"
      current-time={currentTime()}
      // onTextTrackChange={handleTextTrackChange}
      load="eager"
      playbackRate={preferences.speed}
      muted={preferences.muted}
      volume={preferences.volume}
      // key-shortcuts={{
      //   togglePaused: "k Space",
      //   toggleMuted: "m",
      //   toggleFullscreen: "f",
      //   togglePictureInPicture: "i",
      //   toggleCaptions: "c",
      //   seekBackward: "ArrowLeft h",
      //   seekForward: "ArrowRight l",
      //   volumeUp: "ArrowUp",
      //   volumeDown: "ArrowDown",
      // }}
      // on:text-track-change={async (e) => {
      //   console.log(e);
      //   const track = e.detail;
      //   if (track) {
      //     const trackUrl = tracks().find((t) => t.id === track.id)?.metadata
      //       .url;
      //     if (trackUrl) {
      //       const { srtUrl, srtText } = await ttml2srt(trackUrl);
      //       mediaPlayer!.textTracks.getById(track.id)!.content = srtText;

      //       console.log(
      //         mediaPlayer!.textTracks.toArray().find((t) => t.id === track.id)!
      //           .content
      //       );
      //     }
      //   }
      // }}
      key-disabled
      on:volume-change={(e) => {
        console.log(e.detail);
        setPreferences("volume", e.detail.volume);
        setPreferences("muted", e.detail.muted);
      }}
      on:time-update={() => {
        autoSkipHandler();
      }}
      on:can-play={onCanPlay}
      on:provider-change={onProviderChange}
      on:hls-error={handleHlsError}
      on:ended={handleEnded}
      on:play={() => {
        setStarted(true);
        setTimeout(() => {
          updateProgress();
        }, 0);
      }}
      on:seeked={() => {
        updateProgress();
        userNavigationHandler();
      }}
      on:pause={() => {
        updateProgress();
      }}
      on:hls-manifest-loaded={(e: any) => {
        console.log(e.detail, "levels");
      }}
      on:media-player-connect={() => setMediaPlayerConnected(true)}
      autoplay
      ref={mediaPlayer}
      title={props.video?.title ?? ""}
      // src={props.video?.hls ?? ""}
      poster={props.video?.thumbnailUrl ?? ""}
      //       aspect-ratio={props.video?.videoStreams?.[0]
      //           ? props.video.videoStreams[0]?.width /
      //             props.video.videoStreams[0]?.height
      //           :
      // 16 / 9}
      aspect-ratio={16 / 9}
      crossorigin="anonymous"
    >
      <media-provider
        ref={mediaProvider}
        // classList={{"relative min-h-0 max-h-16 pb-0 h-full": preferences.pip}}
      >
        <media-poster
          src={props.video?.thumbnailUrl ?? ""}
          class="absolute inset-0 block h-full w-full rounded-md opacity-0 transition-opacity data-[visible]:opacity-100 [&>img]:h-full [&>img]:w-full [&>img]:object-cover"
        ></media-poster>
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
        {/* <media-captions class="transition-[bottom] not-can-control:opacity-100 user-idle:opacity-100 not-user-idle:bottom-[80px]" /> */}
        <source src={props.video!.hls} type="application/x-mpegurl" />
      </media-provider>
      <Show
        when={
          errors().length > 0 &&
          showErrorScreen().show &&
          !showErrorScreen().dismissed
        }
      >
        <div
          // classList={{hidden: preferences.pip}}
          class="absolute z-50 top-0 right-0 w-full h-full opacity-100 pointer-events-auto bg-black/50"
        >
          <div class="flex flex-col items-center justify-center w-full h-full gap-3">
            <div class="text-2xl font-bold text-white">
              {errors()[errors().length - 1]?.name}{" "}
              {errors()[errors().length - 1]?.details}
            </div>
            <div class="flex flex-col">
              <div class="text-lg text-white">
                {errors()[errors().length - 1]?.message}
              </div>
              <div class="text-lg text-white">
                Please try switching to a different instance or refresh the
                page.
              </div>
            </div>
            <div class="flex justify-center gap-2">
              <button
                class="px-4 py-2 text-lg text-white border border-white rounded-md"
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setShowErrorScreen({ show: false, dismissed: true });
                  }
                }}
                onClick={() => {
                  setShowErrorScreen({ show: false, dismissed: true });
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </Show>
      <Show when={showEndScreen() && nextVideo()}>
        <div class="absolute z-50 scale-50 sm:scale-75 md:scale-100 top-0 right-0 w-full h-full pointer-events-auto">
          <div class="flex flex-col items-center justify-center w-full h-full gap-3">
            <div class="text-2xl font-bold text-white">
              Playing next in {counter()} seconds
            </div>
            <div class="flex flex-col">
              <div class="text-lg text-white w-72">
                <VideoCard v={nextVideo()?.info ?? undefined} />
              </div>
            </div>
            <div class="flex justify-center gap-2">
              <button
                class="px-4 py-2 text-lg text-black bg-white rounded-md"
                onClick={() => {
                  dismiss();
                  playNext();
                }}
              >
                Play now (Shift + N)
              </button>
              <button
                class="px-4 py-2 text-lg text-white bg-black rounded-md"
                onClick={() => {
                  dismiss();
                }}
              >
                Dismiss (Esc)
              </button>
            </div>
          </div>
        </div>
      </Show>
      {/* <PlayerSkin video={props.video} nextVideo={nextVideo()} /> */}
      <VideoLayout
        thumbnails={generateStoryboard(props.video?.previewFrames?.[1]) ?? ""}
      />
      {/* <media-community-skin></media-community-skin> */}
    </media-player>
  );
}
