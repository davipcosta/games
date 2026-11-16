# Sala de Jogos

Coleção de jogos multiplayer para jogar no navegador com os amigos na **mesma rede Wi-Fi**. Um computador roda o servidor e todo mundo entra pelo navegador, no PC ou no celular.

Não tem dependências nem etapa de build: só Node.js e HTML/JS puro.

## Jogos

| Jogo | Gênero | Jogadores |
|---|---|---|
| **Ofensiva** | FPS tático em 3D (WebGL), com loja, bomba e rodadas | 1–16 + bots |
| **Tiro & Treta Online** | Briga de plataforma em 2D com armas | 2–4 + bots |
| **Batalha Minada Online** | Batalha naval com dicas de campo minado | 2 |

### Ofensiva
Rebeldes contra Tática. Modos **Desarmar** (plantar/desarmar a bomba), **Mata-mata** e **Corrida armada**.

`WASD` anda · mouse mira · clique atira · `Espaço` pula · `C`/`Ctrl` agacha · `Shift` anda em silêncio · `R` recarrega · `1`–`5` armas · `B` loja · `E` (segure) planta/desarma · `G` larga a arma · `Tab` placar · `M` troca de time · `Y`/`U` chat geral/time

### Tiro & Treta Online
Pegue as armas que caem do céu, exploda barris e seja o último de pé.

Mouse mira e atira (direito: soco/pegar · meio: granada). Teclado: `A`/`D` ou setas movem · `W`/`↑` pula · `S`/`↓` agacha/desce da plataforma · `F`/`K` atira · `G`/`L` soco/pegar · `H`/`Ç` granada. Também funciona com controle e, no celular, com botões na tela.

### Batalha Minada Online
Batalha naval em que cada tiro na água mostra quantos navios estão ao redor, como no campo minado. Cada jogador usa o próprio aparelho.

## Como rodar

Precisa do [Node.js](https://nodejs.org) 18 ou mais novo.

```bash
node server.js
```

Abra **http://localhost:3000**. O terminal mostra também o endereço na rede local (ex.: `http://192.168.0.10:3000`), que é o que os outros aparelhos usam.

Para usar outra porta:

```bash
PORT=8080 node server.js
```

Cada jogo também roda sozinho, sem o hub: `node ofensiva/server.js`, `node tiro-e-treta/server.js` ou `node batalha-online/server.js`.

> Se os outros aparelhos não conseguirem conectar, libere a porta no firewall do computador que roda o servidor.

## Estrutura

```
server.js              servidor do hub: serve as páginas e monta cada jogo no seu caminho
index.html             página inicial com a lista de jogos
ofensiva/              FPS 3D
  shared.js            mapas, armas, movimento e colisão (navegador + servidor)
  bots.js              IA dos bots (A*)
  server.js            servidor autoritativo: tiros, rodadas, economia
  render.js            renderização WebGL e som
  index.html           cliente
tiro-e-treta/          jogo de plataforma
  motor.js             simulação (navegador + servidor)
  visual.js            desenho e som
  server.js            servidor autoritativo via WebSocket
  online.html          cliente
batalha-online/        batalha naval
  server.js            servidor (Server-Sent Events)
  public/index.html    cliente
```

O WebSocket é implementado na mão sobre o módulo `http` do Node, por isso o projeto não tem `package.json` nem `node_modules`.

## Segurança

O servidor foi feito para **rede local entre conhecidos**: não tem login nem senha, e qualquer pessoa que alcance a porta pode entrar nas salas. **Não exponha a porta na internet** (redirecionamento de porta no roteador, VPS etc.) sem colocar autenticação na frente.
