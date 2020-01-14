// Setup basic express server
var express = require('express');
var app = express();
var fs = require('fs');
var path = require('path');

// Import the wordPool.
var words = require('./words');

// Create a simple Express application
// Serve static html, js, css, and image files from the 'public' directory. i.e. these are user files
app.use(express.static(path.join(__dirname,'public')));

var server = require('http').createServer(app);
var io = require('socket.io')(server);
var port = process.env.PORT || 3000;

server.listen(port, function () {
  console.log('Server listening at port %d', port);
  fs.writeFile(__dirname + '/start.log', 'started', function(err, result) {
    if (err) console.log('error', err);
  }); 
});


// Entire GameCollection Object holds all games and info (This is a singleton object) https://javascript.info/constructor-new
var gameCollection =  new function() {
  this.totalGameCount = 0,
  this.gameList = []
};

// Record all socket connections allClients = { socket1: [roomid1, username1], socket2: [roomid2, username2] }
var allClients = {};


/* *************************
   *      OTHER FUNCTIONS       *
   ************************* */

// Get an 'arrayLength' length array that has random items from 'array' with no duplicates
function shuffle(array, arrayLength) {
  var copy = [], n = array.length, i;
  // while(n)
  // Only get arrayLength words
  for (j=0; j<arrayLength; j++) {
    // Pick a remaining element…
    i = Math.floor(Math.random() * n--);
    // And move it to the new array.
    copy.push(array.splice(i, 1)[0]);
  }
  return copy;
}

// Get a key from a value (this is used specifically for getting the playername from allClients since object[key][1] (LOOK AT THE 1))
function getKeyByValue(object, value) {
  return Object.keys(object).find(key => object[key][1] === value);
}



io.on('connection', function (socket) {

  // createGame: when the client requests to make a Game
  socket.on('createGame', function (username) {
    var gameObject = {};
    var newRoom = (Math.random()+1).toString(36).slice(2,6).toUpperCase(); //Create a gameID which is a 4-digit code
    // If theres already some rooms, check if there is a duplicate
    var duplicateRoom = true;
    if (gameCollection.totalGameCount != 0){
      while (duplicateRoom == true){
        var newRoom = (Math.random()+1).toString(36).slice(2,6).toUpperCase(); //Create a gameID which is a 4-digit code
        for(var i = 0; i < gameCollection.totalGameCount; i++){
          var gameIdTmp = gameCollection.gameList[i]['gameObject']['id'];
          duplicateRoom = false;
          if (gameIdTmp == newRoom){
            duplicateRoom = true;
            console.log("Duplicate room found");
            break;
          }
        }
      }
    }

    // Get 13 random words
    var randomWords = shuffle(words.wordPool, 13);

    gameObject.id = newRoom;
    gameObject.players = [username];
    gameObject.words = randomWords;
    gameObject.clues = null;
    gameObject.currentWordIndex = 0;
    gameObject.noOfCluesSubmitted = 0;
    
    gameCollection.totalGameCount ++;
    gameCollection.gameList.push({gameObject});

    allClients[socket.id] = [newRoom, username] // Adding a client
   
    socket.join(gameObject.id)
  
    console.log("Game Created by "+ username + " w/ " + gameObject.id);

    io.sockets.in(gameObject.id).emit('gameCreated', {
      username: username,
      gameId: gameObject.id
    });
  });

  socket.on('joinGame', function (usernameJoin, accesscodeJoin) {
    console.log(usernameJoin + " wants to join a game"); // NEED TO CHECK IF THERE IS ANY DUPLICATE USERNAMES

    var canFindGametoJoin = false;

    for(var i = 0; i < gameCollection.totalGameCount; i++){
      var gameIdTmp = gameCollection.gameList[i]['gameObject']['id'];
      if (gameIdTmp == accesscodeJoin){
        if (gameCollection.gameList[i]['gameObject']['players'].length < 7){
          gameCollection.gameList[i]['gameObject']['players'].push(usernameJoin)
          socket.join(gameCollection.gameList[i]['gameObject']['id']);
          io.sockets.in(gameCollection.gameList[i]['gameObject']['id']).emit('gameJoined', {
            players: gameCollection.gameList[i]['gameObject']['players'],
            gameId: gameCollection.gameList[i]['gameObject']['id']
          });
          allClients[socket.id] = [accesscodeJoin, usernameJoin] // Adding a client
        }
        else{
          socket.emit('noPlayerSlotsAvailable')
        }
        canFindGametoJoin = true;
      }
    }
    
    // if we cant find the access code, inform the client
    if (canFindGametoJoin == false){
      console.log('Cant find game with that code')
      socket.emit('cantFindGametoJoin')
    }
    
  });



  socket.on('leaveLobby', function (username, gameCode) {
    delete allClients[socket.id]; //Removing a client
    //Need to remove the username, and then check if there is anyone in the lobby, if no one, then remove the game, if people, then remove player and readjust order of players
    for(var i = 0; i < gameCollection.totalGameCount; i++){
      var gameIdTmp = gameCollection.gameList[i]['gameObject']['id']
      if (gameIdTmp == gameCode){
        var usernameIndex = (gameCollection.gameList[i]['gameObject']['players']).indexOf(username);
        if (usernameIndex != -1){
          // Destroy entire room if there is only 1 person in the room
          if (usernameIndex == 0 && (gameCollection.gameList[i]['gameObject']['players']).length == 1){
            --gameCollection.totalGameCount;
            console.log("Destroyed room "+ gameCode);
            gameCollection.gameList.splice(i, 1); //remove that gameObject
            socket.leave(gameCode) // Unlike when we disconnect, we have to leave the socket.io room
            socket.emit('gameDestroyed')
          }
          // Removing player from room if 2 or more people in room
          else{
            gameCollection.gameList[i]['gameObject']['players'].splice(usernameIndex,1)
            console.log("Removed player: " + username + " from room " + gameCode)
            io.sockets.in(gameCode).emit('removedPlayer', {
              players: gameCollection.gameList[i]['gameObject']['players'],
              gameId: gameCollection.gameList[i]['gameObject']['id']
            });
          }
        }
        if (username == -1){
          console.log("Something terribly went wrong, can't find the username in the room")
        }

      }
    }
  });
        

  socket.on('startGame', function (gameCode) {
    for(var i = 0; i < gameCollection.totalGameCount; i++){
      var gameIdTmp = gameCollection.gameList[i]['gameObject']['id']
      if (gameIdTmp == gameCode){
        // Preallocate the clues with nulls depending on no. of players
        amountOfPlayers = gameCollection.gameList[i]['gameObject']['players'].length;

        //if (amountOfPlayers >= 3){ // 3 PLAYER REQUIREMENT REMOVE THIS WHEN FINISHED.
          gameCollection.gameList[i]['gameObject']['clues'] = new Array(amountOfPlayers).fill(null);
          // Submit a socket to the first guesser
          firstplayerSocket = getKeyByValue(allClients, gameCollection.gameList[i]['gameObject']['players'][0])
          io.to(firstplayerSocket).emit('allocateGuesser', gameCollection.gameList[i]['gameObject']['players'][0], gameCode);
        //} // 3 PLAYER REQUIREMENT REMOVE THIS WHEN FINISHED.
        //else { // 3 PLAYER REQUIREMENT REMOVE THIS WHEN FINISHED.
          socket.emit('needMorePlayers')
        //} // 3 PLAYER REQUIREMENT REMOVE THIS WHEN FINISHED.
      }
    }
  });

  socket.on('guesserResponse', function (guesserUsername, gameCode) {
    for(var i = 0; i < gameCollection.totalGameCount; i++){
      var gameIdTmp = gameCollection.gameList[i]['gameObject']['id']
      if (gameIdTmp == gameCode){
        wordIndex = gameCollection.gameList[i]['gameObject']['currentWordIndex'];
        socket.to(gameCode).emit('allocateOthers', guesserUsername, gameCode, gameCollection.gameList[i]['gameObject']['words'][wordIndex]);
      }
    }
  });

  socket.on('clueSubmission', function (guesserUsername, username, gameCode, clue) {
    for(var i = 0; i < gameCollection.totalGameCount; i++){
      var gameIdTmp = gameCollection.gameList[i]['gameObject']['id']
      if (gameIdTmp == gameCode){
        var usernameIndex = gameCollection.gameList[i]['gameObject']['players'].indexOf(username);
        gameCollection.gameList[i]['gameObject']['clues'][usernameIndex] = clue;
        console.log(gameCollection.gameList[i]['gameObject']['clues'])
        gameCollection.gameList[i]['gameObject']['noOfCluesSubmitted']++;
        var numClues = gameCollection.gameList[i]['gameObject']['noOfCluesSubmitted'];
        var maxClues = (gameCollection.gameList[i]['gameObject']['players'].length) - 1;
        if(numClues < maxClues){
          //Update the waiting on list
        } else{
          // Go to the remove words page
          var allClues = gameCollection.gameList[i]['gameObject']['clues'];
          io.sockets.in(gameCode).emit('allFinishedClueSubmission', guesserUsername, gameCode, allClues);
        }
      }
    }
  });

  // If a user disconnects.
  socket.on('disconnect', function () {
    //Need to check if theres actually the socket.id in the allClients list first
    if (socket.id in allClients){
      console.log("A user has disconnected, removing " + allClients[socket.id][1] + " from " + allClients[socket.id][0] )
      var username = allClients[socket.id][1];
      var gameCode = allClients[socket.id][0]
      //Need to remove the username, and then check if there is anyone in the lobby, if no one, then remove the game, if people, then remove player and readjust order of players
      for(var i = 0; i < gameCollection.totalGameCount; i++){
        var gameIdTmp = gameCollection.gameList[i]['gameObject']['id']
        if (gameIdTmp == gameCode){
          var usernameIndex = (gameCollection.gameList[i]['gameObject']['players']).indexOf(username);
          if (usernameIndex != -1){
            // Destroy entire room if there is only 1 person in the room
            if (usernameIndex == 0 && (gameCollection.gameList[i]['gameObject']['players']).length == 1){
              --gameCollection.totalGameCount;
              console.log("Destroyed room "+ gameCode);
              gameCollection.gameList.splice(i, 1); //remove that gameObject
              // socket.leave(gameCode)
              socket.emit('gameDestroyed')
            }
            // Removing player from room if 2 or more people in room
            else{
              gameCollection.gameList[i]['gameObject']['players'].splice(usernameIndex,1)
              console.log("Removed player: " + username + " from room " + gameCode)
              io.sockets.in(gameCode).emit('removedPlayer', {
                players: gameCollection.gameList[i]['gameObject']['players'],
                gameId: gameCollection.gameList[i]['gameObject']['id']
              });
            }
          }
          if (username == -1){
            console.log("Something terribly went wrong, can't find the username in the room")
          }

        }
      }
      delete allClients[socket.id]; //Removing a client
    }
  });

});


