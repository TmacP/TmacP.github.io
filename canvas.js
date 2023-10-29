// canvas.js

const gameSpeed = 100; // Delay in milliseconds
// Score tracking
let score = 0;

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
let food = { x: 15, y: 15 };
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
    } else {
        // Remove the tail segment
        snake.pop();
    }

    // Check for game over
    if (checkCollision()) {
        resetGame();
    }


    // Draw the snake
    snake.forEach(segment => {
        ctx.fillStyle = "green";
        ctx.fillRect(segment.x, segment.y, snakeSize, snakeSize);
    });

    // Draw the food
    ctx.fillStyle = "red";
    ctx.fillRect(food.x, food.y, snakeSize, snakeSize);

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

// Start the game loop
gameLoop();

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
