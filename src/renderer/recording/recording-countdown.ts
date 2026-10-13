import './recording-countdown.css';
const api = window.one!.recordingCountdown!;
function tick(seconds: number) {
  document.getElementById('seconds')!.textContent = String(Math.max(1, seconds));
  const ring = document.querySelector<SVGCircleElement>('.ring')!;
  ring.classList.remove('running');
  void ring.getBoundingClientRect();
  ring.classList.add('running');
}
api.onTick(tick);
void api.state().then(tick);
document.getElementById('cancel')!.onclick = () => void api.cancel();
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    void api.cancel();
  }
});
