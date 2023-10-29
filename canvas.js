// canvas.js

const gameSpeed = 100; // Delay in milliseconds
// Score tracking
let score = 0;
let hiscore = 0;

// Update and display the score
function updateScore() {
    const scoreElement = document.getElementById("score");
    if (scoreElement) {
        scoreElement.textContent = `Score: ${score}`;
    }
}

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// Snake properties
const snakeSize = 10;
let snake = [{ x: 10, y: 10 }];
let food = randomFood();
let direction = "right";

// Function to generate random coordinates for the food
function randomFood() {
    return {
        x: Math.floor(Math.random() * (canvas.width / snakeSize)) * snakeSize,
        y: Math.floor(Math.random() * (canvas.height / snakeSize)) * snakeSize
    };
}

// restart the game
function resetGame() {
    snake = [{ x: 10, y: 10 }];
    food = randomFood();
    direction = "right";
    // Update high score if the current score is higher
    if (score > hiscore) {
        hiscore = score;
    }
    score = 0;
    updateScore();
}


// Main game loop
function gameLoop() {
    // Clear the canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Update snake position
    let newHead = { x: snake[0].x, y: snake[0].y };
    if (direction === "right") newHead.x += snakeSize;
    if (direction === "left") newHead.x -= snakeSize;
    if (direction === "up") newHead.y -= snakeSize;
    if (direction === "down") newHead.y += snakeSize;
    snake.unshift(newHead);

    // Check for collision with food
    if (newHead.x === food.x && newHead.y === food.y) {
        // Increase the snake's length and generate new food
        snake.push({});
        food = randomFood();
        score++;
        updateScore();
        snake.pop();
    } else {
        // Remove the tail segment
        snake.pop();
    }

    // Check for game over
    if (checkCollision()) {
        resetGame();
    }


    // Draw the snake (as rectangles)
    ctx.fillStyle = "green";
    snake.forEach(segment => {
        ctx.fillRect(segment.x, segment.y, snakeSize, snakeSize);
    });

    // Draw the food (as circles)
    ctx.fillStyle = "red";
    ctx.beginPath();
    ctx.arc(food.x + snakeSize / 2, food.y + snakeSize / 2, snakeSize / 2, 0, Math.PI * 2, false);
    ctx.fill();
    ctx.closePath();

    // Draw the score
    ctx.fillStyle = "black";
    ctx.fillText("wasd to move", canvas.width / 2 - 80, canvas.height / 2 - 20);
    ctx.fillText(`Your score is ${score}`, canvas.width / 2 - 80, canvas.height / 2);
    ctx.fillText(`High score is ${hiscore}`, canvas.width / 2 - 80, canvas.height / 2 + 20);


    // Repeat the game loop with a delay
    setTimeout(gameLoop, gameSpeed);
}

// Handle user input for controlling the snake with arrow keys and WASD
document.addEventListener("keydown", event => {
    switch (event.key) {
        case "ArrowUp":
        case "w":
            if (direction !== "down") direction = "up";
            break;
        case "ArrowDown":
        case "s":
            if (direction !== "up") direction = "down";
            break;
        case "ArrowLeft":
        case "a":
            if (direction !== "right") direction = "left";
            break;
        case "ArrowRight":
        case "d":
            if (direction !== "left") direction = "right";
            break;
    }
});


// Game over condition
function checkCollision() {
    // Check if the snake hits the canvas boundaries or itself
    const head = snake[0];
    if (
        head.x < 0 ||
        head.x >= canvas.width ||
        head.y < 0 ||
        head.y >= canvas.height ||
        snake.slice(1).some(segment => segment.x === head.x && segment.y === head.y)
    ) {
        return true;
    }
    return false;
}

// Start the game loop
gameLoop();
