import * as THREE from 'three';
import { canvasTextur } from './bausatz';

export type BlasenArt = 'brief' | 'baustelle' | 'uhr' | 'fehler' | 'denken' | 'sanduhr';

const DUNKEL = '#2b3a55';
const ZEICHNER: Record<BlasenArt, (x: CanvasRenderingContext2D) => void> = {
  brief: (x) => {
    x.fillStyle = '#f7e7c4';
    x.strokeStyle = DUNKEL;
    x.lineWidth = 9;
    x.lineJoin = 'round';
    x.beginPath();
    x.roundRect(52, 74, 152, 104, 12);
    x.fill();
    x.stroke();
    x.beginPath();
    x.moveTo(56, 80);
    x.lineTo(128, 136);
    x.lineTo(200, 80);
    x.stroke();
    x.fillStyle = '#e8413c';
    x.beginPath();
    x.arc(128, 136, 16, 0, 7);
    x.fill();
  },
  baustelle: (x) => {
    x.fillStyle = '#ffc23d';
    x.beginPath();
    x.moveTo(128, 34);
    x.lineTo(212, 184);
    x.lineTo(44, 184);
    x.closePath();
    x.fill();
    x.lineWidth = 9;
    x.lineJoin = 'round';
    x.strokeStyle = DUNKEL;
    x.stroke();
    // Schaufel-Symbol
    x.fillStyle = DUNKEL;
    x.save();
    x.translate(128, 128);
    x.rotate(-0.6);
    x.fillRect(-5, -52, 10, 62);
    x.beginPath();
    x.moveTo(-16, 8);
    x.lineTo(16, 8);
    x.lineTo(12, 34);
    x.quadraticCurveTo(0, 44, -12, 34);
    x.closePath();
    x.fill();
    x.restore();
  },
  uhr: (x) => {
    x.fillStyle = '#e8413c';
    x.beginPath();
    x.arc(128, 118, 68, 0, 7);
    x.fill();
    x.fillStyle = '#fff';
    x.beginPath();
    x.arc(128, 118, 52, 0, 7);
    x.fill();
    x.strokeStyle = DUNKEL;
    x.lineWidth = 10;
    x.lineCap = 'round';
    x.beginPath();
    x.moveTo(128, 118);
    x.lineTo(128, 80);
    x.moveTo(128, 118);
    x.lineTo(154, 132);
    x.stroke();
  },
  fehler: (x) => {
    x.fillStyle = '#e8413c';
    x.beginPath();
    x.arc(128, 118, 70, 0, 7);
    x.fill();
    x.fillStyle = '#fff';
    x.fillRect(116, 70, 24, 62);
    x.fillRect(116, 146, 24, 22);
  },
  denken: (x) => {
    x.fillStyle = DUNKEL;
    for (const dx of [-48, 0, 48]) {
      x.beginPath();
      x.arc(128 + dx, 120, 17, 0, 7);
      x.fill();
    }
  },
  sanduhr: (x) => {
    x.fillStyle = '#f2c14e';
    x.strokeStyle = DUNKEL;
    x.lineWidth = 9;
    x.lineJoin = 'round';
    x.beginPath();
    x.moveTo(80, 56);
    x.lineTo(176, 56);
    x.lineTo(136, 120);
    x.lineTo(176, 184);
    x.lineTo(80, 184);
    x.lineTo(120, 120);
    x.closePath();
    x.fill();
    x.stroke();
  },
};

const texturen = new Map<BlasenArt, THREE.Texture>();
function blasenTextur(art: BlasenArt) {
  let t = texturen.get(art);
  if (!t) {
    t = canvasTextur(256, 300, (x) => {
      const form = (dy: number) => {
        x.beginPath();
        x.arc(128, 118 + dy, 104, 0, Math.PI * 2);
        x.moveTo(96, 210 + dy);
        x.lineTo(128, 288 + dy);
        x.lineTo(160, 210 + dy);
        x.closePath();
      };
      x.fillStyle = 'rgba(20,40,70,.28)';
      form(8);
      x.fill();
      x.fillStyle = '#ffffff';
      form(0);
      x.fill();
      x.save();
      x.translate(0, -6);
      ZEICHNER[art](x);
      x.restore();
    });
    texturen.set(art, t);
  }
  return t;
}

const materialien = new Map<BlasenArt, THREE.SpriteMaterial>();
/** Sprechblase, Anker an der Spitze unten */
export function blase(art: BlasenArt, groesse: number): THREE.Sprite {
  let m = materialien.get(art);
  if (!m) materialien.set(art, (m = new THREE.SpriteMaterial({ map: blasenTextur(art), depthTest: false, depthWrite: false })));
  const s = new THREE.Sprite(m);
  s.center.set(0.5, 0);
  s.scale.set(groesse, (groesse * 300) / 256, 1);
  s.renderOrder = 20;
  s.userData.blase = art;
  return s;
}

/** Namensschild (eigene Textur je Text) */
export function namensschild(text: string): THREE.Sprite {
  const tex = canvasTextur(512, 112, (k) => {
    k.font = '700 54px system-ui, sans-serif';
    const b = Math.min(500, k.measureText(text).width + 56);
    k.fillStyle = 'rgba(30,45,70,.88)';
    k.beginPath();
    k.roundRect((512 - b) / 2, 10, b, 84, 42);
    k.fill();
    k.fillStyle = '#fff';
    k.textAlign = 'center';
    k.textBaseline = 'middle';
    k.fillText(text, 256, 54, 470);
  });
  // Namensschilder werden von Häusern davor verdeckt (sonst schwebt „Einkaufsladen“ über dem Rathaus)
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, depthWrite: false }));
  s.scale.set(2.6, 0.57, 1);
  s.renderOrder = 19;
  return s;
}
